const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, ...args);
};
for (const ext of ['.ts', '.tsx']) {
  Module._extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
}
const { normalizeInternationalPhone, phoneInputProblem } = require('../lib/auth/phone.ts');
const { validateRegistrationInput, summarizeRegistrationErrors, orderedErrorFields } = require('../lib/registration/form-validation.ts');
const { uploadMetadataProblem, inferUploadType } = require('../lib/registration/upload-files.ts');

test('phone input typed on phones normalises to the same Malaysian number', () => {
  const variants = [
    '012-345 6789',
    'O12-345 6789', // letter O instead of zero
    'o12 345 6789',
    '012\u2013345\u20146789', // en / em dashes
    '012\u2212345\u00a06789', // minus sign + no-break space
    '\uff10\uff11\uff12\uff13\uff14\uff15\uff16\uff17\uff18\uff19', // full-width digits
    '+60 12-345 6789',
    '+60 012-345 6789', // trunk zero kept after +60
    '60123456789',
    '0060 12 345 6789',
    '(012) 345.6789',
    '012/345 6789',
  ];
  for (const value of variants) {
    const phone = normalizeInternationalPhone(value);
    assert.ok(phone, `expected ${JSON.stringify(value)} to parse`);
    assert.equal(phone.e164, '+60123456789', value);
    assert.ok(phone.lookupDigits.includes('0123456789'));
    assert.ok(phone.lookupDigits.includes('60123456789'));
    assert.equal(phoneInputProblem(value), null);
  }
  assert.equal(normalizeInternationalPhone('011-2345 6789').e164, '+601123456789');
});

test('existing phone results keep their lookup order', () => {
  assert.deepEqual(normalizeInternationalPhone('0123456789').lookupDigits, ['0123456789', '60123456789']);
  assert.deepEqual(normalizeInternationalPhone('+60123456789').lookupDigits, ['60123456789', '0123456789']);
  assert.deepEqual(normalizeInternationalPhone('+62 812 3456 7890').lookupDigits, ['6281234567890']);
});

test('unusable phone numbers get a specific reason instead of silently failing', () => {
  assert.equal(normalizeInternationalPhone('088-123456'), null);
  assert.match(phoneInputProblem('088-123456'), /starting with 01/);
  assert.match(phoneInputProblem('0812 3456 7890'), /country code/); // Indonesian local format is not guessed as Malaysian
  assert.match(phoneInputProblem('012-345'), /too short/);
  assert.match(phoneInputProblem('call me'), /only contain digits/);
  assert.match(phoneInputProblem(''), /Enter the tenant's phone/);
});

const reservation = {
  accountType: 'tenant', registrationMode: 'reservation', identityType: 'ic',
  fullName: 'Tenant Name', phone: '012-345 6789', identityNumber: '',
  propertyId: 'p', roomId: 'r', rentalModel: 'tenancy', agreedMonthlyRent: '400', agreedDeposit: '400',
  reservationDeposit: '100.00', paymentDate: '2026-11-22', hasPaymentSlip: true,
};

test('the screenshot reservation (RM100, 22 Nov, PNG slip, no ID photos) passes when the top fields are filled', () => {
  assert.deepEqual(validateRegistrationInput(reservation), {});
  // IC number and photos remain optional for a reservation.
  assert.deepEqual(validateRegistrationInput({ ...reservation, identityNumber: '' }), {});
});

test('every missing field is named, not one generic message', () => {
  const errors = validateRegistrationInput({ ...reservation, fullName: ' ', phone: 'O12\u2013345', roomId: '', paymentDate: '' });
  assert.deepEqual(orderedErrorFields(errors), ['roomId', 'fullName', 'phone', 'paymentDate']);
  const summary = summarizeRegistrationErrors(errors);
  assert.match(summary, /Room/);
  assert.match(summary, /Full name/);
  assert.match(summary, /Phone \/ WhatsApp/);
  assert.match(summary, /Payment date/);
  assert.doesNotMatch(summary, /Complete all required registration details/);
});

test('check-in money rules mirror the server', () => {
  const checkIn = { ...reservation, registrationMode: 'check_in', reservationDeposit: undefined, hasPaymentSlip: false, paymentDate: '', rentPaid: '400', depositPaid: '0' };
  const errors = validateRegistrationInput(checkIn);
  assert.ok(errors.paymentSlip);
  assert.ok(errors.paymentDate);
  assert.match(validateRegistrationInput({ ...checkIn, rentPaid: '500', hasPaymentSlip: true, paymentDate: '2026-11-22' }).rentPaid, /more than the agreed rent/);
  assert.deepEqual(validateRegistrationInput({ ...checkIn, rentPaid: '0', depositPaid: '0' }), {});
});

test('owners still need an identity number; monthly stay needs no deposit', () => {
  assert.ok(validateRegistrationInput({ accountType: 'owner', identityType: 'ic', fullName: 'Owner', phone: '0123456789' }).identityNumber);
  assert.deepEqual(validateRegistrationInput({ ...reservation, rentalModel: 'monthly_stay', agreedDeposit: '' }), {});
});

test('upload rules accept phone photos and explain refusals', () => {
  assert.equal(uploadMetadataProblem({ name: 'IMG_1906.png', size: 500000, type: 'image/png' }), null);
  assert.equal(uploadMetadataProblem({ name: 'IMG_1906.PNG', size: 500000, type: '' }), null);
  assert.equal(inferUploadType('slip.jpg', 'image/jpg'), 'image/jpeg');
  assert.equal(uploadMetadataProblem({ name: 'slip.webp', size: 1, type: 'image/webp' }), null);
  assert.match(uploadMetadataProblem({ name: 'IMG_1.HEIC', size: 900000, type: 'image/heic' }), /HEIC/);
  assert.match(uploadMetadataProblem({ name: 'big.jpg', size: 12 * 1024 * 1024, type: 'image/jpeg' }), /12\.0 MB.*10 MB/);
});

test('server returns field-specific errors instead of the old generic banner', () => {
  const route = fs.readFileSync(path.join(root, 'app/api/register/start/route.ts'), 'utf8');
  assert.doesNotMatch(route, /Complete all required registration details/);
  assert.match(route, /validateRegistrationInput/);
  assert.match(route, /fieldErrors/);
  const complete = fs.readFileSync(path.join(root, 'app/api/register/complete/route.ts'), 'utf8');
  assert.match(complete, /fieldErrors/);
});

test('public form marks each field so the first problem can be focused', () => {
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { RegistrationForm } = require('../app/register/registration-form.tsx');
  const html = renderToStaticMarkup(React.createElement(RegistrationForm, { properties: [], rooms: [] }));
  for (const field of ['propertyId', 'roomId', 'fullName', 'identityNumber', 'phone', 'agreedMonthlyRent', 'agreedDeposit', 'icFront', 'icBack', 'paymentSlip', 'rentPaid', 'depositPaid', 'paymentDate']) {
    assert.match(html, new RegExp(`data-field="${field}"`), field);
  }
  assert.match(html, /\.heic/);
  const source = fs.readFileSync(path.join(root, 'app/register/registration-form.tsx'), 'utf8');
  assert.match(source, /scrollIntoView/);
  assert.match(source, /focus\(\{ preventScroll: true \}\)/);
  assert.match(source, /prepareRegistrationUpload/);
});
