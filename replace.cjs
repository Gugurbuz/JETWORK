const fs = require('fs');
const content = fs.readFileSync('src/App.tsx', 'utf8');
const lines = content.split('\n');
const startIdx = lines.findIndex(l => l.includes('// Send a message'));
const endIdx = lines.findIndex((l, i) => i > startIdx && l.includes('const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);'));

if (startIdx !== -1 && endIdx !== -1) {
  const newLines = [
    '  const {',
    '    isGenerating,',
    '    isDiscussing,',
    '    aiHandRaised,',
    '    activeTab,',
    '    setActiveTab,',
    '    handleSendMessage,',
    '    handleAcceptAiHandRaise,',
    '    handleGenerateDocument',
    '  } = useAI(',
    '    currentWorkspaceId,',
    '    user,',
    '    messages,',
    '    setMessages,',
    '    documentContent,',
    '    setDocumentContent,',
    '    isZeroTouchMode,',
    '    activeZeroTouchRoles,',
    '    channelRef,',
    '    isAiActive',
    '  );',
    '',
    lines[endIdx]
  ];
  
  const finalLines = [...lines.slice(0, startIdx), ...newLines, ...lines.slice(endIdx + 1)];
  fs.writeFileSync('src/App.tsx', finalLines.join('\n'));
  console.log('Replaced successfully');
} else {
  console.log('Could not find start or end index', startIdx, endIdx);
}
