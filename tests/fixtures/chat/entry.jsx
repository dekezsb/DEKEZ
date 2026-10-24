// Local synthetic test only. This entry is never imported by the application.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChatWorkspace } from '../../../components/chat/workspace';
import { ChatLauncher } from '../../../components/chat/launcher';
import { ChatSupport } from '../../../components/chat/support';
import { ChatAccessSetup } from '../../../components/chat/access-setup';
const actor = new URLSearchParams(location.search).get('actor') || '1';
const userId = `00000000-0000-0000-0000-${actor.padStart(12, '0')}`;
createRoot(document.getElementById('root')).render(<React.StrictMode><ChatLauncher endpoint={`/api/dekez-chat/${actor}`}/>{new URLSearchParams(location.search).has('setup') ? <ChatAccessSetup endpoint={`/api/dekez-chat/${actor}`}/> : new URLSearchParams(location.search).has('support') ? <ChatSupport userId={userId} endpoint={`/api/dekez-chat/${actor}`}/> : <ChatWorkspace userId={userId} endpoint={`/api/dekez-chat/${actor}`} realtimeEnabled filesEnabled/>}</React.StrictMode>);
