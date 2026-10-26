import React from 'react';
import { createRoot } from 'react-dom/client';
import { TestReportControl } from '../../../app/admin-setup/management-report/test-control';

createRoot(document.getElementById('root')).render(<main className="p-4 sm:p-6 lg:p-8">
  <h1 className="mb-4 text-2xl font-semibold">Local synthetic one-time test preview</h1>
  <p className="mb-4 text-sm">No real authorization, database or WhatsApp request. Ordinary flags and the schedule remain disabled.</p>
  <TestReportControl enabled />
</main>);
