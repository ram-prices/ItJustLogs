import exporter from '../../scripts/export-pulls.ps1?raw';

// The trailing newline closes the block when pasted; PowerShell still needs one Enter to run it.
export const EXPORTER_SOURCE = `${exporter.trim()}\n`;
