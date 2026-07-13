// Trinno Chat WebView Script

(function () {
  'use strict';

  const messagesContainer = document.getElementById('messages');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('btn-send');
  const attachBtn = document.getElementById('btn-attach');
  const attachMenu = document.getElementById('attach-menu');
  const attachmentsContainer = document.getElementById('attachments');
  const agentBtn = document.getElementById('btn-agent');
  const agentMenu = document.getElementById('agent-menu');
  const agentLabel = document.getElementById('agent-label');
  const modelBtn = document.getElementById('btn-model');
  const modelMenu = document.getElementById('model-menu');
  const modelLabel = document.getElementById('model-label');
  const settingsBtn = document.getElementById('btn-settings');
  const statusSessionEl = document.getElementById('status-session');
  const statusMessagesEl = document.getElementById('status-messages');
  const statusMcpEl = document.getElementById('status-mcp');
  const statusSandboxEl = document.getElementById('status-sandbox');
  let lspStatus = null;

  // Initialize Mermaid
  if (typeof mermaid !== 'undefined') {
    try { mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' }); } catch {}
  } else if (typeof __esbuild_esm_mermaid_nm !== 'undefined' && __esbuild_esm_mermaid_nm.mermaid) {
    window.mermaid = __esbuild_esm_mermaid_nm.mermaid;
    try { mermaid.initialize({ startOnLoad: false, theme: 'default', securityLevel: 'loose' }); } catch {}
  }

  // Custom marked renderer for mermaid/SVG blocks (one-time setup)
  if (typeof marked !== 'undefined') {
    marked.use({
      renderer: {
        code({ text, lang }) {
          if (lang === 'mermaid') {
            const id = 'mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
            return '<div class="mermaid-container" data-mermaid-id="' + id + '">' +
              '<pre class="mermaid-source" style="display:none">' + escapeHtml(text) + '</pre>' +
              '<div id="' + id + '" class="mermaid-target"></div></div>\n';
          }
          if (lang === 'svg') {
            return '<div class="svg-preview">' + text.trim() + '</div>\n';
          }
          return false;
        }
      }
    });
  }

  let currentMessageEl = null;
  let currentContentEl = null;
  let currentReasoningContentEl = null;
  let currentToolsEl = null;
  let currentToolsLogEl = null;
  let isGenerating = false;
  let thinkingIntervalId = null;
  const thinkingWords = [
    'thinking', 'pondering', 'computing', 'processing', 'ruminating',
    'synthesizing', 'analyzing', 'reasoning', 'deliberating', 'contemplating',
    'cogitating', 'musing', 'reflecting', 'meditating', 'wondering',
    'brainstorming', 'connecting', 'weaving', 'exploring', 'searching',
  ];
  let hasReceivedToken = false;
  let pendingRetry = null;
  let lastUserMessageText = '';
  let personaName = 'Research Assistant';
  let currentSessionId = '';
  let currentSessionTitle = '';
  let sessions = [];
  let isCompacted = false;
  let sandboxEnabled = false;
  let sessionMenuVisible = false;
  let attachMenuVisible = false;
  let agentMenuVisible = false;
  let modelMenuVisible = false;
  let attachments = [];
  let agents = [{ name: 'Research Assistant', description: 'TRIZ research expert' }];
  let models = [];
  let mcpServers = [];
  let mcpDropdownVisible = false;
  let mcpDropdownEl = null;
  let selectedAgent = 'Research Assistant';
  let selectedModel = 'Auto';
  let tokenUsage = { input: 0, output: 0, total: 0 };
  let todoData = [];
  let messageQueue = [];
  let queuePanelEl = null;
  const vscode = acquireVsCodeApi();

  let slashCommands = [
    { name: 'init', description: 'Initialize a Trinno workspace (creates 8 phase folders + READMEs + AGENTS.md)' },
    { name: 'session', description: 'Manage sessions: list, select, delete, rename' },
    { name: 'new', description: 'Create a new chat session' },
    { name: 'compact', description: 'Compact current session: summarize old messages, reduce context' },
    { name: 'contradiction', description: 'Analyze technical contradictions using TRIZ matrix' },
    { name: 'search', description: 'Search patents, papers, and technical solutions' },
    { name: 's-curve', description: 'Technology maturity S-curve analysis with TRL' },
    { name: 'ideality', description: 'Evaluate system ideality (benefits/costs/harms)' },
    { name: 'principles', description: 'List or search the 40 TRIZ inventive principles' },
    { name: 'su-field', description: 'Substance-Field model analysis' },
    { name: 'patent', description: 'Incrementally write a patent document (LLM appends section by section)' },
    { name: 'download', description: 'Download a paper PDF by DOI / arXiv ID / PMID / URL' },
    { name: 'get', description: 'Search OpenAlex and auto-download the top match (or top 3 with "all")' },
    { name: 'papers', description: 'List downloaded papers in the output directory' },
    { name: 'help', description: 'Show all available commands' },
    { name: 'ping', description: 'Probe LLM model token limits (context window, max output, working limit)' },
    { name: 'goal', description: 'Set, view, edit, pause, resume, annotate, log, or clear a persistent research goal' },
    { name: 'undo', description: 'Undo the last AI prompt — jj abandon the change created before that prompt' },
    { name: 'auto', description: 'Start/continue an AutoResearch iteration loop: propose → act → evaluate → ratchet' },
    { name: 'recover', description: 'Recover from token limit: trim stale messages and large tool results. Use /recover keep <N>' },
  ];
  let pendingApproval = null;

  function clearPendingApproval() {
    if (pendingApproval) {
      const el = document.getElementById(`approval-${pendingApproval.id}`);
      if (el) el.remove();
      pendingApproval = null;
    }
  }
  let completionVisible = false;
  let completionIndex = 0;
  let filteredCommands = [];

  let fileCompletionVisible = false;
  let fileCompletionIndex = 0;
  let fileCompletionItems = [];
  let workspaceFiles = [];
  let workspaceRootCached = '';
  let fileListLoaded = false;
  let fileListLoading = false;
  let fileCompletionQuery = '';
  let fileCompletionStart = 0;

  let reasoningRafId = null;
  let textRafId = null;

  const messageState = {
    content: '',
    reasoning: '',
    reasoningVisible: false,
    tools: [],
    toolLog: [],
  };

  init();

  function updateStatusBar() {
    if (statusSessionEl) {
      statusSessionEl.textContent = currentSessionTitle || 'No session';
    }
    if (statusMessagesEl) {
      if (tokenUsage.total > 0) {
        statusMessagesEl.textContent = `${tokenUsage.total.toLocaleString()} tokens (${tokenUsage.input.toLocaleString()} in / ${tokenUsage.output.toLocaleString()} out)`;
      } else {
        statusMessagesEl.textContent = '0 tokens';
      }
    }
  }

  function updateSandboxStatus() {
    if (!statusSandboxEl) return;
    if (sandboxEnabled) {
      statusSandboxEl.innerHTML = '<span class="sandbox-badge">Sandbox</span>';
    } else {
      statusSandboxEl.innerHTML = '';
    }
  }

  function updateMcpStatus() {
    if (!statusMcpEl) return;

    const connected = mcpServers.filter(s => s.connected);
    const failed = mcpServers.filter(s => !s.connected);
    const hasMcp = mcpServers.length > 0;
    const hasLsp = lspStatus && lspStatus.status !== 'disconnected';

    const parts = [];
    if (hasMcp) {
      let label = `&#9654; MCP (${connected.length}/${mcpServers.length})`;
      if (failed.length > 0) {
        label += ` <span style="color:#e74c3c">&#9679;</span>`;
      }
      parts.push(`<span class="mcp-label" data-type="mcp">${label}</span>`);
    }
    if (hasLsp) {
      const dotClass = lspStatus.status === 'connected' ? 'connected' : 'starting';
      const tracked = lspStatus.trackedFile ? ` ${lspStatus.trackedFile.split('/').pop()}` : '';
      const lspCount = lspStatus.status !== 'disconnected' ? 1 : 0;
      parts.push(`<span class="mcp-label" data-type="lsp">&#9654; LSP (${lspCount})${tracked} <span class="mcp-dropdown-item-dot ${dotClass}"></span></span>`);
    }

    statusMcpEl.innerHTML = parts.join('');
    statusMcpEl.style.display = 'flex';
    statusMcpEl.style.gap = '12px';

    if (parts.length === 0) {
      if (mcpDropdownEl) mcpDropdownEl.classList.remove('visible');
      return;
    }

    statusMcpEl.onclick = (e) => {
      e.stopPropagation();
      const label = e.target.closest('.mcp-label');
      const type = label ? label.getAttribute('data-type') : 'mcp';
      if (type === 'lsp') {
        renderLspDropdown();
      } else {
        mcpDropdownVisible = !mcpDropdownVisible;
        if (mcpDropdownVisible) {
          renderMcpDropdown();
          mcpDropdownEl.classList.add('visible');
        } else {
          mcpDropdownEl.classList.remove('visible');
        }
      }
    };

    if (mcpDropdownVisible) {
      renderMcpDropdown();
    }
  }

  function renderTodoBadges() {
    let targetEl = currentMessageEl || messagesContainer.querySelector('.message.assistant:last-of-type');
    if (!targetEl) {
      targetEl = document.createElement('div');
      targetEl.className = 'message assistant';
      messagesContainer.appendChild(targetEl);
    }

    let todoSection = targetEl.querySelector('.todo-section');
    if (!todoSection) {
      todoSection = document.createElement('div');
      todoSection.className = 'todo-section';
      const refEl = targetEl.querySelector('.message-content') || targetEl.querySelector('.reasoning-section');
      if (refEl) {
        targetEl.insertBefore(todoSection, refEl);
      } else {
        targetEl.appendChild(todoSection);
      }
    }

    if (!todoData || todoData.length === 0) {
      todoSection.innerHTML = '';
      return;
    }

    const done = todoData.filter(t => t.status === 'completed').length;
    const running = todoData.filter(t => t.status === 'in_progress').length;
    const total = todoData.length;

    let html = `<div class="todo-summary" onclick="this.parentElement.querySelector('.todo-list').classList.toggle('collapsed')">`;
    html += `<span class="todo-count">`;
    if (running > 0) html += `<span class="todo-spinner-inline"></span> `;
    html += `${done}/${total} tasks`;
    html += `</span><span class="todo-toggle">▼</span></div>`;
    html += `<div class="todo-list collapsed">`;
    for (const t of todoData) {
      const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : t.status === 'cancelled' ? '❌' : '⬜';
      html += `<div class="todo-item"><span class="todo-icon">${icon}</span><span class="todo-text">${escapeHtml(t.content)}</span></div>`;
    }
    html += `</div>`;

    todoSection.innerHTML = html;
  }

  function updateTodoList(todos) {
    const el = document.getElementById('status-todos');
    if (!el) return;
    if (!todos || todos.length === 0) {
      el.style.display = 'none';
      return;
    }
    el.style.display = '';
    const active = todos.filter(t => t.status === 'in_progress' || t.status === 'pending');
    const done = todos.filter(t => t.status === 'completed');
    const total = todos.length;
    if (active.length === 0 && done.length === total && total > 0) {
      el.innerHTML = `<span class="todo-label">&#9654; TODOs (${total}/${total}) ✅</span>`;
    } else if (active.length > 0) {
      el.innerHTML = `<span class="todo-label">&#9654; TODOs (${done.length}/${total})</span>`;
    } else {
      el.innerHTML = `<span class="todo-label">&#9654; TODOs (0/${total})</span>`;
    }
    el.onclick = () => {
      renderTodoDropdown(todos);
    };
  }

  function renderTodoDropdown(todos) {
    if (!mcpDropdownEl) return;
    const items = todos.map(t => {
      const icon = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : t.status === 'cancelled' ? '❌' : '⬜';
      return `<div class="mcp-dropdown-item">
        <span>${icon}</span>
        <span class="mcp-dropdown-item-name" style="margin-left:6px">${t.content}</span>
        <span style="opacity:0.6;font-size:11px">${t.status}</span>
      </div>`;
    }).join('');
    mcpDropdownEl.innerHTML = `
      <div class="mcp-dropdown-header">TODOs</div>
      <div class="mcp-dropdown-list">${items || '<div class="mcp-dropdown-empty">No tasks</div>'}</div>`;
    mcpDropdownEl.classList.add('visible');
    setTimeout(() => {
      const hide = () => {
        mcpDropdownEl.classList.remove('visible');
        document.removeEventListener('click', hide);
      };
      document.addEventListener('click', hide);
    }, 0);
  }

  function updateLspStatus(msg) {
    lspStatus = msg;
    updateMcpStatus();
  }

  function renderMcpDropdown() {
    if (!mcpDropdownEl) return;
    if (mcpServers.length === 0) {
      mcpDropdownEl.innerHTML = `
        <div class="mcp-dropdown-header">MCP Servers</div>
        <div class="mcp-dropdown-empty">No MCP servers configured</div>`;
      return;
    }
    const items = mcpServers.map(s => `
      <div class="mcp-dropdown-item">
        <span class="mcp-dropdown-item-dot ${s.connected ? 'connected' : 'disconnected'}"></span>
        <span class="mcp-dropdown-item-name">${s.name}</span>
        <span style="opacity:0.6;font-size:11px">${s.connected ? 'connected' : 'disconnected'}</span>
      </div>`).join('');
    mcpDropdownEl.innerHTML = `
      <div class="mcp-dropdown-header">MCP Servers</div>
      <div class="mcp-dropdown-list">${items}</div>`;
  }

  function renderLspDropdown() {
    if (!mcpDropdownEl || !lspStatus) return;
    const status = lspStatus.status || 'disconnected';
    const dotClass = status === 'connected' ? 'connected' : (status === 'starting' ? 'starting' : 'disconnected');
    const name = lspStatus.name || 'tinymist';
    const tracked = lspStatus.trackedFile || '';
    const rows = [
      `<div class="mcp-dropdown-item">
        <span class="mcp-dropdown-item-dot ${dotClass}"></span>
        <span class="mcp-dropdown-item-name">${name}</span>
        <span style="opacity:0.6;font-size:11px">${status}</span>
      </div>`];
    if (tracked) {
      rows.push(`<div class="mcp-dropdown-item">
        <span class="mcp-dropdown-item-name">File</span>
        <span style="opacity:0.6;font-size:11px">${tracked}</span>
      </div>`);
    }
    mcpDropdownEl.innerHTML = `
      <div class="mcp-dropdown-header">LSP Server</div>
      <div class="mcp-dropdown-list">${rows.join('')}</div>`;
    mcpDropdownEl.classList.add('visible');
    setTimeout(() => {
      const hide = () => {
        mcpDropdownEl.classList.remove('visible');
        document.removeEventListener('click', hide);
      };
      document.addEventListener('click', hide);
    }, 0);
  }

  function hideMcpDropdown() {
    mcpDropdownVisible = false;
    if (mcpDropdownEl) mcpDropdownEl.classList.remove('visible');
  }

  function init() {
    mcpDropdownEl = document.createElement('div');
    mcpDropdownEl.className = 'mcp-dropdown';
    document.body.appendChild(mcpDropdownEl);

    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', handleInputKeydown);
    inputEl.addEventListener('input', handleInput);
    attachBtn.addEventListener('click', toggleAttachMenu);
    agentBtn.addEventListener('click', toggleAgentMenu);
    modelBtn.addEventListener('click', toggleModelMenu);
    settingsBtn.addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }));
    attachmentsContainer.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.chip-remove');
      if (removeBtn) {
        const index = parseInt(removeBtn.dataset.index, 10);
        if (!isNaN(index)) removeAttachment(index);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isGenerating) {
        cancelGeneration();
      }
      if (e.key === 'Escape') {
        if (attachMenuVisible) hideAttachMenu();
        if (agentMenuVisible) hideAgentMenu();
        if (modelMenuVisible) hideModelMenu();
        hideMcpDropdown();
      }
    });

    document.addEventListener('click', (e) => {
      if (completionVisible && !e.target.closest('.completion-popup')) {
        hideCompletion();
      }
      if (fileCompletionVisible && !e.target.closest('.file-completion-popup')) {
        hideFileCompletion();
      }
      if (sessionMenuVisible && !e.target.closest('.session-menu')) {
        hideSessionMenu();
      }
      if (attachMenuVisible && !e.target.closest('.attach-menu') && !e.target.closest('#btn-attach')) {
        hideAttachMenu();
      }
      if (agentMenuVisible && !e.target.closest('#agent-menu') && !e.target.closest('#btn-agent')) {
        hideAgentMenu();
      }
      if (modelMenuVisible && !e.target.closest('#model-menu') && !e.target.closest('#btn-model')) {
        hideModelMenu();
      }
      if (mcpDropdownVisible && !e.target.closest('.mcp-dropdown') && !e.target.closest('#status-mcp')) {
        hideMcpDropdown();
      }
    });

    attachMenu.querySelectorAll('.attach-menu-item').forEach((item) => {
      item.addEventListener('click', () => {
        const action = item.dataset.action;
        hideAttachMenu();
        if (action === 'selection') {
          vscode.postMessage({ type: 'sendSelection' });
        } else if (action === 'file') {
          vscode.postMessage({ type: 'sendFile' });
        } else if (action === 'choose') {
          vscode.postMessage({ type: 'chooseFile' });
        }
      });
    });

    document.addEventListener('keydown', (e) => {
      if (!sessionMenuVisible) return;
      const overlay = document.querySelector('.session-overlay');
      if (!overlay) return;

      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault();
        let active = overlay.querySelector('.session-row.active');
        if (!active) {
          active = overlay.querySelector('.session-row');
        }
        if (active) {
          vscode.postMessage({ type: 'deleteSession', sessionId: active.dataset.id });
          renderSessionMenu();
        }
      }
    });

    window.addEventListener('message', handleExtensionMessage);
    autoResize();

    messagesContainer.addEventListener('mouseup', handleCopyOnSelect);
    messagesContainer.addEventListener('click', handleReasoningToggle);
  }

  function handleReasoningToggle(e) {
    const header = e.target.closest('.reasoning-header');
    if (!header) return;
    const section = header.closest('.reasoning-section');
    const content = section?.querySelector('.reasoning-content');
    const hint = header.querySelector('.reasoning-hint');
    if (!content) return;
    content.classList.toggle('collapsed');
    if (hint) {
      hint.textContent = content.classList.contains('collapsed') ? '[click to expand]' : '[click to collapse]';
    }
  }

  function handleCopyOnSelect(e) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    navigator.clipboard.writeText(selectedText).catch(() => {});
    showCopyTooltip(e.clientX, e.clientY);
  }

  function showCopyTooltip(x, y) {
    const existing = document.querySelector('.copy-tooltip');
    if (existing) existing.remove();

    const tip = document.createElement('div');
    tip.className = 'copy-tooltip';
    tip.textContent = 'Copied to clipboard';
    tip.style.left = (x+60) + 'px';
    tip.style.top = (y - 100) + 'px';
    document.body.appendChild(tip);

    requestAnimationFrame(() => tip.classList.add('visible'));
    setTimeout(() => {
      tip.classList.remove('visible');
      setTimeout(() => tip.remove(), 200);
    }, 1200);
  }

  function handleInputKeydown(e) {
    if (fileCompletionVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        fileCompletionIndex = Math.min(fileCompletionIndex + 1, fileCompletionItems.length - 1);
        renderFileCompletion();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        fileCompletionIndex = Math.max(fileCompletionIndex - 1, 0);
        renderFileCompletion();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        selectFileCompletion(fileCompletionIndex);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideFileCompletion();
        return;
      }
    }

    if (completionVisible) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        completionIndex = Math.min(completionIndex + 1, filteredCommands.length - 1);
        renderCompletion();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        completionIndex = Math.max(completionIndex - 1, 0);
        renderCompletion();
        return;
      }
      if (e.key === 'Tab' || e.key === 'Enter') {
        if (completionVisible) {
          e.preventDefault();
          selectCompletion(completionIndex);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideCompletion();
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && !completionVisible && !fileCompletionVisible) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleInput() {
    autoResize();
    const val = inputEl.value;
    const cursorPos = inputEl.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);

    const slashMatch = textBeforeCursor.match(/\/(\w*)$/);
    if (slashMatch) {
      hideFileCompletion();
      const prefix = slashMatch[1].toLowerCase();
      filteredCommands = slashCommands.filter(c => c.name.toLowerCase().includes(prefix));
      if (filteredCommands.length > 0) {
        completionIndex = 0;
        showCompletion();
      } else {
        hideCompletion();
      }
      return;
    }

    const atMatch = textBeforeCursor.match(/(^|[\s\u4e00-\u9fa5])@([^\s@]*)$/);
    if (atMatch) {
      hideCompletion();
      const query = atMatch[2] || '';
      fileCompletionStart = atMatch.index + atMatch[1].length;
      fileCompletionQuery = query;
      ensureFileListLoaded();
      const items = filterWorkspaceFiles(query);
      fileCompletionItems = items;
      if (items.length > 0) {
        fileCompletionIndex = 0;
        showFileCompletion();
      } else if (!fileListLoading) {
        hideFileCompletion();
      }
      return;
    }

    hideCompletion();
    hideFileCompletion();
  }

  function ensureFileListLoaded() {
    if (fileListLoaded || fileListLoading) return;
    fileListLoading = true;
    vscode.postMessage({ type: 'request-file-list' });
  }

  function triggerFileCompletionFromInput() {
    const cursorPos = inputEl.selectionStart;
    const val = inputEl.value;
    const textBeforeCursor = val.slice(0, cursorPos);
    const atMatch = textBeforeCursor.match(/(^|[\s\u4e00-\u9fa5])@([^\s@]*)$/);
    if (!atMatch) return;
    const query = atMatch[2] || '';
    fileCompletionStart = atMatch.index + atMatch[1].length;
    fileCompletionQuery = query;
    const items = filterWorkspaceFiles(query);
    fileCompletionItems = items;
    if (items.length > 0) {
      fileCompletionIndex = 0;
      showFileCompletion();
    } else {
      hideFileCompletion();
    }
  }

  function fuzzyMatch(text, query) {
    let qi = 0;
    for (let ti = 0; ti < text.length && qi < query.length; ti++) {
      if (text[ti] === query[qi]) qi++;
    }
    return qi === query.length;
  }

  function filterWorkspaceFiles(query) {
    const q = query.toLowerCase();
    if (!q) return workspaceFiles.slice(0, 30);
    return workspaceFiles
      .filter(f => fuzzyMatch(f.path.toLowerCase(), q) || fuzzyMatch(f.name.toLowerCase(), q))
      .slice(0, 30);
  }

  function showCompletion() {
    let popup = document.querySelector('.completion-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'completion-popup';
      inputEl.parentElement.style.position = 'relative';
      inputEl.parentElement.appendChild(popup);
    }
    completionVisible = true;
    renderCompletion();
  }

  function hideCompletion() {
    completionVisible = false;
    const popup = document.querySelector('.completion-popup');
    if (popup) popup.remove();
  }

  function showFileCompletion() {
    let popup = document.querySelector('.file-completion-popup');
    if (!popup) {
      popup = document.createElement('div');
      popup.className = 'file-completion-popup completion-popup';
      inputEl.parentElement.style.position = 'relative';
      inputEl.parentElement.appendChild(popup);
    }
    fileCompletionVisible = true;
    renderFileCompletion();
  }

  function hideFileCompletion() {
    fileCompletionVisible = false;
    const popup = document.querySelector('.file-completion-popup');
    if (popup) popup.remove();
  }

  function renderFileCompletion() {
    const popup = document.querySelector('.file-completion-popup');
    if (!popup) return;
    if (fileCompletionItems.length === 0) {
      popup.innerHTML = `<div class="completion-empty">${fileListLoading ? '加载文件列表…' : '无匹配文件'}</div>`;
      return;
    }
    popup.innerHTML = fileCompletionItems.map((f, i) => {
      const active = i === fileCompletionIndex ? ' active' : '';
      const icon = f.isDir ? '📁' : '📄';
      const display = f.isDir ? f.path : f.path;
      return `<div class="completion-item${active}" data-index="${i}">
        <span class="completion-icon">${icon}</span>
        <span class="completion-name">${escapeHtml(display)}</span>
      </div>`;
    }).join('');
    popup.querySelectorAll('.completion-item').forEach((item) => {
      item.addEventListener('click', () => {
        selectFileCompletion(parseInt(item.dataset.index, 10));
      });
    });
    const activeEl = popup.querySelector('.completion-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function selectFileCompletion(index) {
    const f = fileCompletionItems[index];
    if (!f) return;
    const val = inputEl.value;
    const cursorPos = inputEl.selectionStart;
    const textAfterCursor = val.slice(cursorPos);
    const before = val.slice(0, fileCompletionStart);
    const inserted = '@' + f.path;
    inputEl.value = before + inserted + textAfterCursor;
    const newCursor = before.length + inserted.length;
    inputEl.selectionStart = inputEl.selectionEnd = newCursor;
    inputEl.focus();
    hideFileCompletion();
    autoResize();
  }

  function toggleAttachMenu() {
    if (attachMenuVisible) {
      hideAttachMenu();
    } else {
      attachMenuVisible = true;
      attachMenu.style.display = 'block';
    }
  }

  function hideAttachMenu() {
    attachMenuVisible = false;
    attachMenu.style.display = 'none';
  }

  function toggleAgentMenu() {
    if (agentMenuVisible) {
      hideAgentMenu();
    } else {
      hideAttachMenu();
      hideModelMenu();
      hideMcpDropdown();
      agentMenuVisible = true;
      renderAgentMenu();
      agentMenu.style.display = 'block';
    }
  }

  function hideAgentMenu() {
    agentMenuVisible = false;
    agentMenu.style.display = 'none';
  }

  function toggleModelMenu() {
    if (modelMenuVisible) {
      hideModelMenu();
    } else {
      hideAttachMenu();
      hideAgentMenu();
      hideMcpDropdown();
      modelMenuVisible = true;
      renderModelMenu();
      modelMenu.style.display = 'block';
    }
  }

  function hideModelMenu() {
    modelMenuVisible = false;
    modelMenu.style.display = 'none';
  }

  function renderAgentMenu() {
    agentMenu.innerHTML = agents.map((a, i) => {
      const active = a.name === selectedAgent ? ' active' : '';
      return `<div class="dropdown-item${active}" data-agent="${escapeHtml(a.name)}">
        <span class="dropdown-item-label">${escapeHtml(a.name)}</span>
        <span class="dropdown-item-hint">${escapeHtml(a.description || '')}</span>
      </div>`;
    }).join('');
    agentMenu.querySelectorAll('.dropdown-item').forEach((item) => {
      item.addEventListener('click', () => {
        selectedAgent = item.dataset.agent;
        agentLabel.textContent = selectedAgent === 'Research Assistant' ? 'Research' : selectedAgent;
        hideAgentMenu();
        vscode.postMessage({ type: 'setAgent', agent: selectedAgent });
      });
    });
  }

  function renderModelMenu() {
    const items = [{ name: 'Auto', description: 'Use default' }, ...models];
    modelMenu.innerHTML = items.map((m) => {
      const active = m.name === selectedModel ? ' active' : '';
      return `<div class="dropdown-item${active}" data-model="${escapeHtml(m.name)}">
        <span class="dropdown-item-label">${escapeHtml(m.name)}</span>
        ${m.description ? `<span class="dropdown-item-hint">${escapeHtml(m.description)}</span>` : ''}
      </div>`;
    }).join('');
    modelMenu.querySelectorAll('.dropdown-item').forEach((item) => {
      item.addEventListener('click', () => {
        selectedModel = item.dataset.model;
        modelLabel.textContent = selectedModel;
        hideModelMenu();
        vscode.postMessage({ type: 'setModel', model: selectedModel });
      });
    });
  }

  function addAttachment(attachment) {
    attachments.push(attachment);
    renderAttachments();
  }

  function removeAttachment(index) {
    attachments.splice(index, 1);
    renderAttachments();
  }

  function renderAttachments() {
    attachmentsContainer.innerHTML = '';
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i];
      const chip = document.createElement('div');
      chip.className = 'attachment-chip';
      const shortPath = att.filePath.split('/').pop() || att.filePath;
      const label = att.lineRange ? `${shortPath}:${att.lineRange}` : shortPath;
      
      const modeIcon = att.mode === 'reference' ? '📎 ' : '';
      
      chip.innerHTML = `
        <span class="chip-icon">${att.language.slice(0, 2).toUpperCase()}</span>
        <span class="chip-label" title="${escapeHtml(att.filePath)}">${modeIcon}${escapeHtml(label)}</span>
        <button class="chip-remove" data-index="${i}">&times;</button>
      `;
      attachmentsContainer.appendChild(chip);
    }
  }

  function getAttachmentText() {
    if (attachments.length === 0) return '';
    return attachments.map(att => {
      const header = `📎 ${att.filePath}${att.lineRange ? `:${att.lineRange}` : ''} (${att.language})`;
      if (att.mode === 'reference') {
        const hint = `Use \`read_file("${att.filePath}"${att.startLine ? `, startLine=${att.startLine}` : ''}${att.endLine ? `, endLine=${att.endLine}` : ''})\` for full content.`;
        return `${header}\n\`\`\`${att.language}\n${att.content}\n\`\`\`\n${hint}`;
      } else {
        return `${header}\n\`\`\`${att.language}\n${att.content}\n\`\`\``;
      }
    }).join('\n\n');
  }

  function clearAttachments() {
    attachments = [];
    renderAttachments();
  }

  function toggleSessionMenu() {
    if (sessionMenuVisible) {
      hideSessionMenu();
    } else {
      showSessionMenu();
    }
  }

  function showSessionMenu() {
    let overlay = document.querySelector('.session-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'session-overlay';
      document.getElementById('app').appendChild(overlay);

      // Use event delegation on overlay for all interactive elements
      overlay.addEventListener('click', (e) => {
        // Close on backdrop click
        if (e.target === overlay) {
          hideSessionMenu();
          return;
        }

        // Session row delete button click
        const deleteBtn = e.target.closest('.session-row-delete');
        if (deleteBtn) {
          e.stopPropagation();
          e.preventDefault();
          const sessionId = deleteBtn.dataset.deleteId;
          vscode.postMessage({ type: 'deleteSession', sessionId });
          hideSessionMenu();
          return;
        }

        // Session row click
        const row = e.target.closest('.session-row');
        if (row) {
          showSwitchingIndicator();
          vscode.postMessage({ type: 'switchSession', sessionId: row.dataset.id });
          hideSessionMenu();
          return;
        }

        // Footer shortcuts click
        const footerSpan = e.target.closest('.session-modal-footer span');
        if (footerSpan) {
          const text = footerSpan.textContent || '';
          if (text.includes('new')) {
            vscode.postMessage({ type: 'newSession' });
            hideSessionMenu();
          } else if (text.includes('delete')) {
            let active = overlay.querySelector('.session-row.active');
            if (!active) {
              active = overlay.querySelector('.session-row');
            }
            if (active) {
              vscode.postMessage({ type: 'deleteSession', sessionId: active.dataset.id });
              renderSessionMenu();
            }
          } else if (text.includes('rename')) {
            let active = overlay.querySelector('.session-row.active');
            if (!active) {
              active = overlay.querySelector('.session-row');
            }
            if (active) {
              const session = sessions.find(s => s.id === active.dataset.id);
              if (session) {
                showPrompt('Rename session:', session.title, (newTitle) => {
                  if (newTitle && newTitle.trim()) {
                    vscode.postMessage({ type: 'renameSession', sessionId: session.id, title: newTitle.trim() });
                  }
                });
              }
            }
          } else if (text.includes('clear sel')) {
            const active = overlay.querySelector('.session-row.active');
            if (active) {
              active.classList.remove('active');
            }
          } else if (text.includes('clear all')) {
            showConfirm('Delete ALL sessions? This cannot be undone.', () => {
              for (const s of sessions) {
                vscode.postMessage({ type: 'deleteSession', sessionId: s.id });
              }
              hideSessionMenu();
            });
          }
          return;
        }
      });

      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          hideSessionMenu();
          return;
        }

        if (e.ctrlKey && e.key === 'd') {
          e.preventDefault();
          const active = overlay.querySelector('.session-row.active');
          if (active) {
            vscode.postMessage({ type: 'deleteSession', sessionId: active.dataset.id });
            hideSessionMenu();
          }
        }

        if (e.ctrlKey && e.key === 'n') {
          e.preventDefault();
          vscode.postMessage({ type: 'newSession' });
          hideSessionMenu();
        }

        if (e.ctrlKey && e.key === 'z') {
          e.preventDefault();
          let active = overlay.querySelector('.session-row.active');
          if (!active) {
            active = overlay.querySelector('.session-row');
          }
          if (active) {
            vscode.postMessage({ type: 'deleteSession', sessionId: active.dataset.id });
            renderSessionMenu();
          }
        }

        if (e.ctrlKey && e.key === 'r') {
          e.preventDefault();
          let active = overlay.querySelector('.session-row.active');
          if (!active) {
            active = overlay.querySelector('.session-row');
          }
          if (active) {
            const session = sessions.find(s => s.id === active.dataset.id);
            if (session) {
              showPrompt('Rename session:', session.title, (newTitle) => {
                if (newTitle && newTitle.trim()) {
                  vscode.postMessage({ type: 'renameSession', sessionId: session.id, title: newTitle.trim() });
                }
              });
            }
          }
        }

        if (e.ctrlKey && e.shiftKey && e.key === 'C') {
          e.preventDefault();
          const active = overlay.querySelector('.session-row.active');
          if (active) {
            active.classList.remove('active');
          }
        }

        if (e.ctrlKey && e.shiftKey && e.key === 'D') {
          e.preventDefault();
          showConfirm('Delete ALL sessions? This cannot be undone.', () => {
            for (const s of sessions) {
              vscode.postMessage({ type: 'deleteSession', sessionId: s.id });
            }
            hideSessionMenu();
          });
        }

        // Arrow key navigation
        const rows = Array.from(overlay.querySelectorAll('.session-row'));
        let currentActive = overlay.querySelector('.session-row.active');
        if (!currentActive && rows.length > 0) {
          currentActive = rows[0];
          currentActive.classList.add('active');
        }
        const currentIndex = rows.indexOf(currentActive);

        if (e.key === 'ArrowDown') {
          e.preventDefault();
          if (currentIndex < rows.length - 1) {
            currentActive?.classList.remove('active');
            rows[currentIndex + 1].classList.add('active');
            rows[currentIndex + 1].scrollIntoView({ block: 'nearest' });
          }
        }

        if (e.key === 'ArrowUp') {
          e.preventDefault();
          if (currentIndex > 0) {
            currentActive?.classList.remove('active');
            rows[currentIndex - 1].classList.add('active');
            rows[currentIndex - 1].scrollIntoView({ block: 'nearest' });
          }
        }

        if (e.key === 'Enter') {
          e.preventDefault();
          const active = overlay.querySelector('.session-row.active');
          if (active) {
            showSwitchingIndicator();
            vscode.postMessage({ type: 'switchSession', sessionId: active.dataset.id });
            hideSessionMenu();
          }
        }
      });
    }
    sessionMenuVisible = true;
    renderSessionMenu();
    const searchInput = overlay.querySelector('.session-search-input');
    if (searchInput) searchInput.focus();
  }

  function hideSessionMenu() {
    sessionMenuVisible = false;
    const overlay = document.querySelector('.session-overlay');
    if (overlay) overlay.remove();
  }

  function showSwitchingIndicator() {
    let indicator = document.querySelector('.switching-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'switching-indicator';
      indicator.innerHTML = '<div class="switching-spinner"></div><span>Switching session...</span>';
      messagesContainer.appendChild(indicator);
    }
    indicator.style.display = 'flex';
  }

  function hideSwitchingIndicator() {
    const indicator = document.querySelector('.switching-indicator');
    if (indicator) {
      indicator.style.display = 'none';
    }
  }

  function showConfirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog">
        <div class="confirm-message">${escapeHtml(message)}</div>
        <div class="confirm-buttons">
          <button class="confirm-cancel">Cancel</button>
          <button class="confirm-ok">OK</button>
        </div>
      </div>
    `;
    document.getElementById('app').appendChild(overlay);

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
      overlay.remove();
    });
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      overlay.remove();
      onConfirm();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  function showPrompt(message, defaultValue, onSubmit) {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog prompt-dialog">
        <div class="confirm-message">${escapeHtml(message)}</div>
        <input type="text" class="prompt-input" value="${escapeHtml(defaultValue)}" />
        <div class="confirm-buttons">
          <button class="confirm-cancel">Cancel</button>
          <button class="confirm-ok">OK</button>
        </div>
      </div>
    `;
    document.getElementById('app').appendChild(overlay);

    const input = overlay.querySelector('.prompt-input');
    input.focus();
    input.select();

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => {
      overlay.remove();
    });
    overlay.querySelector('.confirm-ok').addEventListener('click', () => {
      const value = input.value;
      overlay.remove();
      onSubmit(value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const value = input.value;
        overlay.remove();
        onSubmit(value);
      }
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.remove();
      }
    });
  }

  function renderSessionMenu() {
    const overlay = document.querySelector('.session-overlay');
    if (!overlay) return;

    overlay.innerHTML = `
      <div class="session-modal">
        <div class="session-modal-header">
          <span class="session-modal-title">Sessions</span>
          <span class="session-modal-hint">esc</span>
        </div>
        <div class="session-search">
          <input type="text" class="session-search-input" placeholder="Search" />
        </div>
        <div class="session-list"></div>
        <div class="session-modal-footer">
          <span><strong>new</strong> <kbd>ctrl+n</kbd></span>
          <span><strong>delete</strong> <kbd>ctrl+z</kbd></span>
          <span><strong>rename</strong> <kbd>ctrl+r</kbd></span>
          <span><strong>clear sel</strong> <kbd>ctrl+shift+c</kbd></span>
          <span><strong>clear all</strong> <kbd>ctrl+shift+d</kbd></span>
        </div>
      </div>
    `;

    const listEl = overlay.querySelector('.session-list');
    const searchInput = overlay.querySelector('.session-search-input');
    const sorted = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);

    const groups = groupSessionsByDate(sorted);

    function renderList(filter = '') {
      const lowerFilter = filter.toLowerCase();
      let html = '';

      for (const [dateLabel, items] of Object.entries(groups)) {
        const filtered = filter
          ? items.filter(s => s.title.toLowerCase().includes(lowerFilter))
          : items;
        if (filtered.length === 0) continue;

        html += `<div class="session-group-label">${dateLabel}</div>`;
        for (const s of filtered) {
          const isActive = s.id === currentSessionId;
          const time = new Date(s.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          html += `<div class="session-row${isActive ? ' active' : ''}" data-id="${s.id}" tabindex="0">
            <span class="session-row-dot${isActive ? ' active-dot' : ''}"></span>
            <span class="session-row-title">${escapeHtml(s.title)}</span>
            <span class="session-row-time">${time}</span>
            <button class="session-row-delete" title="Delete session" data-delete-id="${s.id}">&times;</button>
          </div>`;
        }
      }

      if (!html) {
        html = '<div class="session-empty">No sessions found</div>';
      }

      listEl.innerHTML = html;
    }

    renderList();

    searchInput.addEventListener('input', () => {
      renderList(searchInput.value);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideSessionMenu();
      }
    });
  }

  function groupSessionsByDate(sorted) {
    const groups = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const yesterday = today - 86400000;
    const thisWeek = today - 7 * 86400000;

    for (const s of sorted) {
      const t = s.updatedAt;
      let label;
      if (t >= today) {
        label = 'Today';
      } else if (t >= yesterday) {
        label = 'Yesterday';
      } else if (t >= thisWeek) {
        label = 'This Week';
      } else {
        const d = new Date(t);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        label = `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`;
      }

      if (!groups[label]) groups[label] = [];
      groups[label].push(s);
    }

    return groups;
  }

  function renderCompletion() {
    const popup = document.querySelector('.completion-popup');
    if (!popup) return;

    popup.innerHTML = filteredCommands.map((cmd, i) => {
      const active = i === completionIndex ? ' active' : '';
      return `<div class="completion-item${active}" data-index="${i}">
        <span class="completion-name">/${cmd.name}</span>
        <span class="completion-desc">${cmd.description}</span>
      </div>`;
    }).join('');

    popup.querySelectorAll('.completion-item').forEach((item) => {
      item.addEventListener('click', () => {
        selectCompletion(parseInt(item.dataset.index, 10));
      });
    });

    const activeEl = popup.querySelector('.completion-item.active');
    if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
  }

  function selectCompletion(index) {
    const cmd = filteredCommands[index];
    if (!cmd) return;

    const val = inputEl.value;
    const cursorPos = inputEl.selectionStart;
    const textBeforeCursor = val.slice(0, cursorPos);
    const textAfterCursor = val.slice(cursorPos);

    const slashMatch = textBeforeCursor.match(/(\/)\w*$/);
    if (slashMatch) {
      const startPos = textBeforeCursor.lastIndexOf(slashMatch[0]);
      inputEl.value = val.slice(0, startPos) + '/' + cmd.name + ' ' + textAfterCursor;
      inputEl.selectionStart = inputEl.selectionEnd = startPos + 1 + cmd.name.length + 1;
      inputEl.focus();
    }

    hideCompletion();
    autoResize();
  }

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  }

  function sendMessage() {
    if (autoRetryTimer) {
      clearInterval(autoRetryTimer);
      autoRetryTimer = null;
    }
    isRetrying = false;
    autoRetryAttempt = 0;
    autoRetryCountdown = 15;
    const errorBanners = messagesContainer.querySelectorAll('.error-banner');
    errorBanners.forEach(b => b.remove());
    hideCompletion();
    const text = inputEl.value.trim();
    const attText = getAttachmentText();
    const fullText = attText ? (text ? attText + '\n\n' + text : attText) : text;
    if (!fullText) return;
    vscode.postMessage({ type: 'trace', message: '[webview] user pressed enter', textLength: fullText.length, text: fullText.slice(0, 200) });

    // If already generating, queue the message instead of blocking
    if (isGenerating) {
      if (messageQueue.length >= 20) {
        const wrapper = inputEl.closest('.input-wrapper') || inputEl;
        wrapper.classList.add('queue-full-shake');
        setTimeout(() => wrapper.classList.remove('queue-full-shake'), 600);
        return;
      }
      vscode.postMessage({ type: 'userMessage', text: fullText });
      lastUserMessageText = fullText;
      inputEl.value = '';
      clearAttachments();
      autoResize();
      return;
    }

    sendBtn.disabled = false;
    sendBtn.textContent = '■';
    sendBtn.classList.add('stop-btn');
    sendBtn.onclick = cancelGeneration;
    lastUserMessageText = fullText;
    inputEl.value = '';
    clearAttachments();
    autoResize();
    vscode.postMessage({ type: 'userMessage', text: fullText });
  }

  function ensureQueuePanel() {
    if (queuePanelEl) return queuePanelEl;
    queuePanelEl = document.createElement('div');
    queuePanelEl.className = 'queue-panel';
    queuePanelEl.style.display = 'none';
    const inputArea = document.querySelector('.input-area');
    if (inputArea) {
      inputArea.parentElement.insertBefore(queuePanelEl, inputArea);
    }
    return queuePanelEl;
  }

  function renderQueuePanel() {
    const panel = ensureQueuePanel();
    if (messageQueue.length === 0) {
      panel.style.display = 'none';
      panel.innerHTML = '';
      return;
    }

    panel.style.display = 'block';
    const inFlightItem = messageQueue.find(q => q.status === 'in-flight');
    const pendingItems = messageQueue.filter(q => q.status === 'queued');
    const rateLimitedItem = messageQueue.find(q => q.status === 'rate-limited');

    let html = '';
    
    // Show in-flight or rate-limited
    if (inFlightItem || rateLimitedItem) {
      const activeItem = inFlightItem || rateLimitedItem;
      const preview = truncateText(activeItem.text, 60);
      html += `<div class="queue-item queue-item-active" data-queue-id="${activeItem.queueId}">
        <span class="queue-item-spinner"></span>
        <span class="queue-item-text">${escapeHtml(preview)}</span>
        <button class="queue-item-stop" title="Stop">✕</button>
      </div>`;
    }

    // Show pending items
    if (pendingItems.length > 0) {
      html += `<div class="queue-pending-header">${pendingItems.length} queued message${pendingItems.length > 1 ? 's' : ''}</div>`;
      for (const item of pendingItems) {
        const preview = truncateText(item.text, 60);
        html += `<div class="queue-item queue-item-pending" data-queue-id="${item.queueId}">
          <span class="queue-item-dot"></span>
          <span class="queue-item-text">${escapeHtml(preview)}</span>
          <button class="queue-item-force" title="Force execute (halt current)">▶</button>
          <button class="queue-item-remove" title="Remove from queue">✕</button>
        </div>`;
      }
    }

    panel.innerHTML = html;

    // Attach click handlers via delegation on the panel
    panel.querySelectorAll('.queue-item-remove').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const queueId = btn.closest('[data-queue-id]')?.dataset?.queueId;
        if (queueId) vscode.postMessage({ type: 'queue-remove', queueId });
      };
    });
    panel.querySelectorAll('.queue-item-stop').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const queueId = btn.closest('[data-queue-id]')?.dataset?.queueId;
        if (queueId) vscode.postMessage({ type: 'queue-remove', queueId });
      };
    });
    panel.querySelectorAll('.queue-item-force').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const queueId = btn.closest('[data-queue-id]')?.dataset?.queueId;
        if (queueId) vscode.postMessage({ type: 'queue-force-execute', queueId });
      };
    });
  }

  function truncateText(text, maxLen) {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + '…';
  }

  function handleQueueState(msg) {
    messageQueue = msg.queue || [];
    renderQueuePanel();
    if (isGenerating && messageQueue.length > 0) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
      sendBtn.classList.remove('stop-btn');
      sendBtn.onclick = sendMessage;
    } else if (messageQueue.length === 0 && !isGenerating) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
      sendBtn.classList.remove('stop-btn');
      sendBtn.onclick = sendMessage;
    }
  }

  function handleQueueAdd(msg) {
    messageQueue.push(msg.message);
    renderQueuePanel();
    if (isGenerating) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
      sendBtn.classList.remove('stop-btn');
      sendBtn.onclick = sendMessage;
    }
  }

  function handleQueueRemove(queueId) {
    // Optimistic: remove locally immediately
    messageQueue = messageQueue.filter(q => q.queueId !== queueId);
    renderQueuePanel();
    if (messageQueue.length === 0 && !isGenerating) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
      sendBtn.classList.remove('stop-btn');
      sendBtn.onclick = sendMessage;
    }
  }

  function handleQueueStatusChange(msg) {
    const item = messageQueue.find(q => q.queueId === msg.queueId);
    if (item) {
      item.status = msg.status;
      if (msg.error) item.error = msg.error;
      // Clean up completed/error items from queue after a brief moment for UI
      if (msg.status === 'completed' || msg.status === 'error') {
        setTimeout(() => {
          messageQueue = messageQueue.filter(q => q.queueId !== msg.queueId);
          renderQueuePanel();
          // Reset send button when queue is empty and not generating
          if (messageQueue.length === 0 && !isGenerating) {
            sendBtn.disabled = false;
            sendBtn.textContent = '➤';
            sendBtn.classList.remove('stop-btn');
            sendBtn.onclick = sendMessage;
          }
        }, 500);
      }
    }
    renderQueuePanel();
  }

  function cancelGeneration() {
    if (autoRetryTimer) {
      clearInterval(autoRetryTimer);
      autoRetryTimer = null;
    }
    isRetrying = false;
    clearPendingApproval();
    vscode.postMessage({ type: 'cancel' });
    finalizeMessage();
  }

  function handleExtensionMessage(event) {
    const msg = event.data;

    switch (msg.type) {
      case 'welcome':
        personaName = msg.personaName || 'Research Assistant';
        const titleEl = document.querySelector('.chat-title');
        if (titleEl) titleEl.textContent = personaName;
        if (msg.slashCommands) {
          slashCommands = msg.slashCommands;
        }
        if (msg.sessionId) {
          currentSessionId = msg.sessionId;
          currentSessionTitle = msg.sessionTitle || 'New Chat';
        }
        if (msg.sessions) {
          sessions = msg.sessions;
        }
        if (msg.isCompacted !== undefined) {
          isCompacted = msg.isCompacted;
        }
        if (msg.sandboxEnabled !== undefined) {
          sandboxEnabled = msg.sandboxEnabled;
          updateSandboxStatus();
        }
        if (msg.tokenUsage) {
          tokenUsage = msg.tokenUsage;
        }
        updateStatusBar();
        showWelcome(msg.context);
        break;

      case 'streaming-start':
        startAssistantMessage(msg.messageId);
        break;

      case 'token':
        appendToken(msg);
        break;

      case 'done':
        finalizeMessage();
        break;

      case 'error':
        showError(msg.messageId, msg.error);
        hideSwitchingIndicator();
        break;

      case 'user-message':
        appendUserMessage(msg.message);
        break;

      case 'history-message':
        appendHistoryMessage(msg.message);
        break;

      case 'clearHistory':
        messagesContainer.innerHTML = '';
        messageState.content = '';
        messageState.reasoning = '';
        messageState.tools = [];
        messageState.toolLog = [];
        scrollToBottom();
        break;

      case 'context-update':
        updateWelcomeContext(msg.context);
        break;

      case 'showSessionDialog':
        showSessionMenu();
        break;

      case 'goal-block':
        renderGoalBlock(msg.goal);
        break;

      case 'session-updated':
        currentSessionId = msg.sessionId;
        currentSessionTitle = msg.sessionTitle;
        if (msg.sessions) {
          sessions = msg.sessions;
        }
        if (msg.isCompacted !== undefined) {
          isCompacted = msg.isCompacted;
        }
        updateStatusBar();
        hideSwitchingIndicator();
        break;

      case 'session-list-updated':
        if (msg.sessions) {
          sessions = msg.sessions;
        }
        updateStatusBar();
        break;

      case 'session-title-updated':
        if (msg.sessionId === currentSessionId && msg.title) {
          currentSessionTitle = msg.title;
        }
        break;

      case 'token-usage':
        tokenUsage = msg.usage || tokenUsage;
        updateStatusBar();
        break;

      case 'insert-to-input':
        if (msg.attachment) {
          addAttachment(msg.attachment);
        }
        inputEl.focus();
        autoResize();
        break;

      case 'agents-loaded':
        agents = msg.agents || agents;
        agentLabel.textContent = selectedAgent === 'Research Assistant' ? 'Research' : selectedAgent;
        break;

      case 'models-loaded':
        models = msg.models || [];
        modelLabel.textContent = selectedModel;
        renderModelMenu();
        break;

      case 'mcp-status':
        mcpServers = msg.servers || [];
        updateMcpStatus();
        break;

      case 'lsp-status':
        updateLspStatus(msg);
        break;

      case 'todo-update':
        todoData = msg.todos || [];
        updateTodoList(todoData);
        renderTodoBadges();
        break;

      case 'goal-progress':
        if (goalBlockEl) {
          goalBlockEl.dataset.completed = String(msg.completed ?? '');
          goalBlockEl.dataset.total = String(msg.total ?? '');
          refreshGoalBlockFromDatasets();
        }
        break;

      case 'tool-approval-needed':
        showToolApproval(msg.id, msg.toolName, msg.args, msg.metadata, msg.bashIntent);
        break;

      case 'write-topic-prompt':
        showWriteTopicPrompt(msg.docType, msg.originalText);
        break;

      case 'file-list':
        fileListLoading = false;
        fileListLoaded = true;
        workspaceRootCached = msg.workspaceRoot || '';
        workspaceFiles = (msg.files || []).map(f => ({
          path: f.path,
          name: f.path.split('/').pop().replace(/\/$/, ''),
          isDir: !!f.isDir,
        }));
        if (fileCompletionVisible) {
          fileCompletionItems = filterWorkspaceFiles(fileCompletionQuery);
          fileCompletionIndex = Math.min(fileCompletionIndex, Math.max(0, fileCompletionItems.length - 1));
          renderFileCompletion();
        } else {
          // Retrigger @ completion if input still has active @ context
          triggerFileCompletionFromInput();
        }
        break;

      case 'rate-limited':
        showRateLimited(msg.messageId, msg.retryAfter);
        break;

      case 'rate-limited-tick':
        updateRateLimitedTick(msg.messageId, msg.remaining);
        break;

      case 'paper-progress':
        showPaperProgress(msg.source, msg.status, msg.text);
        break;

      case 'queue-state':
        handleQueueState(msg);
        break;

      case 'queue-add':
        handleQueueAdd(msg);
        break;

      case 'queue-remove':
        handleQueueRemove(msg.queueId);
        break;

      case 'queue-status-change':
        handleQueueStatusChange(msg);
        break;
    }
  }

  function showPaperProgress(source, status, text) {
    let progressEl = document.getElementById('paper-progress');
    if (!progressEl) {
      progressEl = document.createElement('div');
      progressEl.id = 'paper-progress';
      progressEl.className = 'paper-progress-container';
      const spinner = document.createElement('span');
      spinner.className = 'paper-progress-spinner';
      progressEl.appendChild(spinner);
      const label = document.createElement('span');
      label.className = 'paper-progress-label';
      progressEl.appendChild(label);
      messagesContainer.appendChild(progressEl);
    }
    const label = progressEl.querySelector('.paper-progress-label');
    if (label) label.textContent = text;
    if (status === 'success' || status === 'fail') {
      setTimeout(() => { if (progressEl.parentNode) progressEl.remove(); }, 3000);
    }
    scrollToBottom();
  }

  function showWelcome(context) {
    if (messagesContainer.children.length === 0) {
      const welcome = document.createElement('div');
      welcome.className = 'welcome-message';
      welcome.id = 'welcome-msg';
      if (context && context.notebookName) {
        welcome.innerHTML = `I see you have <strong>${escapeHtml(context.notebookName)}</strong> open
          with ${context.cellCount} cell${context.cellCount !== 1 ? 's' : ''}.
          ${context.cursorCell !== null ? `Cursor at cell ${context.cursorCell}.` : ''}
          <br><br>Ask me anything about your notebook, or let me search for prior art and analyze your research.`;
      } else {
        welcome.innerHTML = `Open a Jupyter notebook to start working, or ask me anything about your research.
          I can search patents, papers, and perform TRIZ analysis.`;
      }
      messagesContainer.appendChild(welcome);
    }
  }

  function updateWelcomeContext(context) {
    const welcome = document.getElementById('welcome-msg');
    if (welcome && context) {
      if (context.notebookName) {
        welcome.innerHTML = `I see you have <strong>${escapeHtml(context.notebookName)}</strong> open
          with ${context.cellCount} cell${context.cellCount !== 1 ? 's' : ''}.
          ${context.cursorCell !== null ? `Cursor at cell ${context.cursorCell}.` : ''}
          <br><br>Ask me anything about your notebook, or let me search for prior art.`;
      }
    }
  }

  function appendUserMessage(message) {
    clearWelcome();
    const el = document.createElement('div');
    el.className = 'message user';
    el.innerHTML = `<div class="message-content">${formatContent(message.content)}</div>`;
    messagesContainer.appendChild(el);
    scrollToBottom();
  }

  function appendHistoryMessage(message) {
    clearWelcome();
    const el = document.createElement('div');
    el.className = `message ${message.role}`;

    if (message.role === 'user') {
      el.innerHTML = `<div class="message-content">${formatContent(message.content)}</div>`;
    } else {
      el.innerHTML = `
        ${message.reasoning ? `<div class="reasoning-section"><div class="reasoning-header"> Thinking <span class="reasoning-hint">[click to collapse]</span></div><div class="reasoning-content collapsed">${escapeHtml(message.reasoning)}</div></div>` : ''}
        ${message.toolCalls && message.toolCalls.length > 0 ? renderToolLog(message.toolCalls) : ''}
        <div class="message-content">${formatContent(message.content)}</div>
      `;
    }
    messagesContainer.appendChild(el);
    
    // Render mermaid diagrams in history messages
    renderMermaidDiagrams(el).catch(() => {});
  }

  let goalBlockEl = null;
  let lastGoalData = null;

  function renderGoalBlock(goal) {
    if (!goal || !goal.text) {
      if (goalBlockEl) { goalBlockEl.remove(); goalBlockEl = null; }
      lastGoalData = null;
      return;
    }
    lastGoalData = goal;
    const statusLabel = goal.status === 'active' ? 'Pursuing'
      : goal.status === 'paused' ? 'Paused'
      : goal.status === 'complete' ? 'Complete'
      : goal.status === 'blocked' ? 'Blocked'
      : goal.status === 'budget_limited' ? 'Stalled'
      : goal.status || 'Unknown';
    const statusClass = goal.status === 'active' ? 'goal-active'
      : goal.status === 'complete' ? 'goal-complete'
      : goal.status === 'blocked' ? 'goal-blocked'
      : goal.status === 'paused' ? 'goal-paused'
      : goal.status === 'budget_limited' ? 'goal-stalled'
      : 'goal-inactive';

    // Update existing element or create new one
    if (!goalBlockEl) {
      goalBlockEl = document.createElement('div');
      goalBlockEl.className = 'message assistant';
      goalBlockEl.dataset.goalId = 'goal-block';
      messagesContainer.appendChild(goalBlockEl);
    }

    // Sync datasets from goal-progress messages
    if (goal.progress) {
      goalBlockEl.dataset.completed = String(goal.progress.completed ?? '');
      goalBlockEl.dataset.total = String(goal.progress.total ?? '');
    }

    refreshGoalBlockInner(statusLabel, statusClass, goal);
    scrollToBottom();
  }

  function refreshGoalBlockFromDatasets() {
    if (!goalBlockEl || !lastGoalData) return;
    const goal = lastGoalData;
    const statusLabel = goal.status === 'active' ? 'Pursuing'
      : goal.status === 'paused' ? 'Paused'
      : goal.status === 'complete' ? 'Complete'
      : goal.status === 'blocked' ? 'Blocked'
      : goal.status === 'budget_limited' ? 'Stalled'
      : goal.status || 'Unknown';
    const statusClass = goal.status === 'active' ? 'goal-active'
      : goal.status === 'complete' ? 'goal-complete'
      : goal.status === 'blocked' ? 'goal-blocked'
      : goal.status === 'paused' ? 'goal-paused'
      : goal.status === 'budget_limited' ? 'goal-stalled'
      : 'goal-inactive';
    refreshGoalBlockInner(statusLabel, statusClass, goal);
  }

  function refreshGoalBlockInner(statusLabel, statusClass, goal) {
    const completed = goalBlockEl?.dataset?.completed;
    const total = goalBlockEl?.dataset?.total;
    const progressStr = (completed !== undefined && total !== undefined && total !== '')
      ? ` · ${completed}/${total} sub-tasks` : '';
    const noteHtml = goal.note ? `<div class="mcp-dropdown-item"><span>Note: ${escapeHtml(goal.note)}</span></div>` : '';
    const progressHtml = (goal.progress || (completed !== undefined && total !== undefined && total !== ''))
      ? `<div class="mcp-dropdown-item"><span>Sub-tasks: ${completed ?? (goal.progress?.completed ?? 0)}/${total ?? (goal.progress?.total ?? 0)}</span></div>`
      : '';
    goalBlockEl.innerHTML = `<div class="tool-section">
      <div class="tool-summary">
        <span class="tool-count goal-block-label">
          <span class="goal-badge ${statusClass}">${statusLabel}</span>
          ${escapeHtml(goal.text.length > 80 ? goal.text.slice(0, 80) + '…' : goal.text)}${progressStr}
        </span>
        <span class="tool-toggle">▼</span>
      </div>
      <div class="tool-list collapsed">
        <div class="mcp-dropdown-item">
          <span>Objective: ${escapeHtml(goal.text)}</span>
        </div>
        <div class="mcp-dropdown-item">
          <span>Status: ${statusLabel}</span>
        </div>
        ${progressHtml}
        ${noteHtml}
      </div>
    </div>`;
  }

  function runningToolsSummary(tools, max) {
    const limit = typeof max === 'number' ? max : 3;
    const running = tools.filter(t => t.status === 'running' || t.status === 'waiting' || t.status === 'called');
    if (running.length === 0) return '';
    const labels = running.map(t => formatToolCommand(t.name, t.args));
    const shown = labels.slice(0, limit);
    const overflow = labels.length - shown.length;
    let text = shown.map(l => shortenToolLabel(l, 60)).join(' · ');
    if (overflow > 0) text += ` · +${overflow} more`;
    return ` <span class="tool-running-list">${escapeHtml(text)}</span>`;
  }

  function renderToolLog(tools) {
    if (!tools || tools.length === 0) return '';
    const doneCount = tools.filter(t => t.status === 'done' || t.status === 'result').length;
    const runningCount = tools.filter(t => t.status === 'running' || t.status === 'called' || t.status === 'waiting').length;
    const errorCount = tools.filter(t => t.status === 'error').length;
    const totalCount = tools.length;

    let html = `<div class="tool-section">`;
    html += `<div class="tool-summary" onclick="this.parentElement.querySelector('.tool-list').classList.toggle('collapsed')">`;
    html += `<span class="tool-count">`;
    if (runningCount > 0) html += `<span class="tool-spinner-inline"></span> `;
    html += `${doneCount}/${totalCount} tools`;
    if (runningCount > 0) html += ` (${runningCount} running)`;
    html += runningToolsSummary(tools, 3);
    if (errorCount > 0) html += ` (${errorCount} failed)`;
    html += `</span><span class="tool-toggle">▼</span></div>`;
    html += `<div class="tool-list collapsed">`;
    for (const t of tools) {
      html += renderToolItem(t);
    }
    html += `</div></div>`;
    return html;
  }

  function startAssistantMessage(messageId) {
    if (autoRetryTimer) {
      clearInterval(autoRetryTimer);
      autoRetryTimer = null;
    }
    clearWelcome();
    isGenerating = true;
    // Don't change button if there are queued messages
    if (messageQueue.length === 0) {
      sendBtn.disabled = false;
      sendBtn.textContent = '■';
      sendBtn.classList.add('stop-btn');
      sendBtn.onclick = cancelGeneration;
    }

    messageState.content = '';
    messageState.reasoning = '';
    messageState.reasoningVisible = false;
    messageState.tools = [];
    messageState.toolLog = [];

    currentMessageEl = document.createElement('div');
    currentMessageEl.id = messageId;
    currentMessageEl.className = 'message assistant';

    const reasoningSection = document.createElement('div');
    reasoningSection.className = 'reasoning-section';
    reasoningSection.style.display = 'none';
    reasoningSection.innerHTML = `
        <div class="reasoning-header">
          Thinking <span class="reasoning-hint">[click to collapse]</span>
        </div>
        <div class="reasoning-content collapsed"></div>
    `;
    currentMessageEl.appendChild(reasoningSection);
    currentReasoningContentEl = reasoningSection.querySelector('.reasoning-content');

    const waitingIndicator = document.createElement('div');
    waitingIndicator.className = 'waiting-indicator';
    waitingIndicator.innerHTML = '<span class="waiting-word">thinking</span><span class="waiting-dots"></span>';
    currentMessageEl.appendChild(waitingIndicator);
    hasReceivedToken = false;
    let wordIdx = Math.floor(Math.random() * thinkingWords.length);
    const wordEl = waitingIndicator.querySelector('.waiting-word');
    if (thinkingIntervalId) clearInterval(thinkingIntervalId);
    thinkingIntervalId = setInterval(() => {
      wordIdx = (wordIdx + 1 + Math.floor(Math.random() * 3)) % thinkingWords.length;
      if (wordEl) wordEl.textContent = thinkingWords[wordIdx];
    }, 280);

    currentContentEl = document.createElement('div');
    currentContentEl.className = 'message-content';
    currentContentEl.style.display = 'none';
    currentMessageEl.appendChild(currentContentEl);

    messagesContainer.appendChild(currentMessageEl);
  }

  function appendToken(msg) {
    if (!currentContentEl && !currentReasoningContentEl) return;
    if (!currentMessageEl) return;

    const tokenType = msg.tokenType;
    const text = msg.text || '';
    const msgArgs = msg.args;
    const msgToolId = msg.toolId;
    let hasVisibleContent = false;

    switch (tokenType) {
      case 'ReasoningContent':
        ensureReasoningSection();
        messageState.reasoning += text;
        if (currentReasoningContentEl) {
          currentReasoningContentEl.textContent = messageState.reasoning;
        }
        hasVisibleContent = messageState.reasoning.length > 0;
        break;

      case 'Text':
        messageState.content += text;
        if (textRafId === null) {
          textRafId = requestAnimationFrame(() => {
            if (!currentContentEl) { textRafId = null; return; }
            textRafId = null;
            currentContentEl.innerHTML = formatContent(messageState.content);
            renderMermaidDiagrams(currentContentEl).catch(() => {});
            scrollToBottom();
          });
        }
        hasVisibleContent = messageState.content.length > 0;
        break;

      case 'ToolCall':
        const toolName = text.trim();
        if (!toolName) break;

        let existingTool = messageState.tools.find(t => {
          if (!(t.name === toolName && (t.status === 'running' || t.status === 'waiting'))) return false;
          if (msgToolId) return t.id === msgToolId;
          return true;
        });

        if (!existingTool && msgToolId) {
          const sameNameRunning = messageState.tools.filter(t =>
            t.name === toolName && (t.status === 'running' || t.status === 'waiting')
          );
          if (sameNameRunning.length === 1) {
            existingTool = sameNameRunning[0]; // same tool, different id source
          }
        }

        if (existingTool) {
          if (msgArgs !== undefined) existingTool.args = msgArgs;
          if (msgToolId && !existingTool.id) existingTool.id = msgToolId;
          const logEntry = messageState.toolLog.find(l =>
            l.name === toolName && l.status === 'running' && !l.id
          );
          if (logEntry && msgArgs !== undefined && logEntry.args === undefined) {
            logEntry.args = msgArgs;
          }
          renderToolBadges();
          break;
        }

        const newTool = { name: toolName, status: 'running', result: '' };
        if (msgArgs !== undefined) newTool.args = msgArgs;
        if (msgToolId) newTool.id = msgToolId;
        messageState.tools.push(newTool);
        messageState.toolLog.push({ name: toolName, status: 'running', args: msgArgs });
        renderToolBadges();
        hasVisibleContent = true;
        break;

      case 'ToolResult':
        let lastRunning = [...messageState.tools].reverse().find(t => {
          if (t.status !== 'running') return false;
          if (msgToolId) return t.id === msgToolId;
          return true;
        });
        if (!lastRunning && msgToolId) {
          lastRunning = [...messageState.tools].reverse().find(t => t.status === 'running');
        }
        if (lastRunning) {
          const isDenied = text && (text.includes('PERMISSION_DENIED') || text.includes('denied by user') || text.includes('User denied'));
          lastRunning.status = isDenied ? 'error' : 'done';
          lastRunning.result = text || '';
          if (msgToolId && !lastRunning.id) lastRunning.id = msgToolId;
        }
        let lastLog = [...messageState.toolLog].reverse().find(t => {
          if (t.status !== 'running') return false;
          if (msgToolId) return t.id === msgToolId;
          return true;
        });
        if (!lastLog && msgToolId) {
          lastLog = [...messageState.toolLog].reverse().find(t => t.status === 'running');
        }
        if (lastLog) {
          const isDenied2 = text && (text.includes('PERMISSION_DENIED') || text.includes('denied by user') || text.includes('User denied'));
          lastLog.status = isDenied2 ? 'error' : 'done';
          lastLog.result = text || '';
          if (msgToolId && !lastLog.id) lastLog.id = msgToolId;
        }
        renderToolBadges();
        hasVisibleContent = true;
        break;
    }

    const waitingIndicator = currentMessageEl?.querySelector('.waiting-indicator');
    if (waitingIndicator && hasVisibleContent) {
      if (thinkingIntervalId) {
        clearInterval(thinkingIntervalId);
        thinkingIntervalId = null;
      }
      waitingIndicator.remove();
      if (currentContentEl) currentContentEl.style.display = '';
    }

    scrollToBottom();
  }

  function renderToolBadges() {
    if (!currentMessageEl) return;

    let toolsSection = currentMessageEl.querySelector('.tool-section');
    if (!toolsSection) {
      toolsSection = document.createElement('div');
      toolsSection.className = 'tool-section';
      currentMessageEl.insertBefore(toolsSection, currentContentEl);
    }

    const doneCount = messageState.tools.filter(t => t.status === 'done').length;
    const runningCount = messageState.tools.filter(t => t.status === 'running' || t.status === 'waiting').length;
    const errorCount = messageState.tools.filter(t => t.status === 'error').length;
    const totalCount = messageState.tools.length;

    if (totalCount === 0) {
      toolsSection.innerHTML = '';
      return;
    }

    let html = `<div class="tool-summary" onclick="this.parentElement.querySelector('.tool-list').classList.toggle('collapsed')">`;
    html += `<span class="tool-count">`;
    if (runningCount > 0) html += `<span class="tool-spinner-inline"></span> `;
    html += `${doneCount}/${totalCount} tools`;
    if (runningCount > 0) html += ` (${runningCount} running)`;
    html += runningToolsSummary(messageState.tools, 3);
    if (errorCount > 0) html += `, ${errorCount} failed`;
    html += `</span><span class="tool-toggle">▼</span></div>`;

    html += `<div class="tool-list collapsed">`;
    for (const t of messageState.tools) {
      html += renderToolItem(t);
    }
    html += `</div>`;

    toolsSection.innerHTML = html;
  }

  function shortenToolLabel(label, maxLen) {
    if (typeof label !== 'string') return '';
    const flat = label.replace(/\s+/g, ' ').trim();
    if (flat.length <= maxLen) return flat;
    if (maxLen <= 1) return flat.slice(0, maxLen);
    const head = Math.ceil((maxLen - 1) / 2);
    const tail = Math.floor((maxLen - 1) / 2);
    return flat.slice(0, head) + '…' + flat.slice(flat.length - tail);
  }

  function formatToolCommand(toolName, args) {
    let parsed = args;
    if (typeof parsed === 'string') {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }

    const argValue = (key) => {
      if (!parsed || typeof parsed !== 'object') return undefined;
      const v = parsed[key];
      if (v === null || v === undefined) return undefined;
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return undefined;
    };
    const argArray = (key) => {
      if (!parsed || typeof parsed !== 'object') return undefined;
      const v = parsed[key];
      return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : undefined;
    };

    if (toolName === 'bash') {
      const cmd = argValue('command') ?? argValue('cmd');
      if (cmd) return `${shortenToolLabel(cmd, 80)}`;
      const backup = window.__lastApprovalArgs;
      if (backup) {
        const bkpCmd = (typeof backup === 'object' && backup !== null) ? (backup.command || backup.cmd) : undefined;
        if (bkpCmd) return `${shortenToolLabel(bkpCmd, 80)}`;
      }
    }
    if (toolName === 'exec_tool') {
      const cmd = argValue('command');
      const arr = argArray('args');
      const parts = [cmd, ...(arr ?? [])].filter(Boolean).map((s) => shortenToolLabel(s, 40));
      if (parts.length > 0) return `${parts.join(' ')}`;
    }
    const singlePathArgs = ['filePath', 'filepath', 'path', 'file', 'target', 'target_file'];
    for (const k of singlePathArgs) {
      const v = argValue(k);
      if (v) return `${toolName} ${shortenToolLabel(v, 80)}`;
    }
    if (toolName === 'grep_search') {
      const p = argValue('pattern'), q = argValue('query'), d = argValue('dir') ?? argValue('dirPath');
      if (p || q) return `${toolName} ${shortenToolLabel(p ?? q, 60)} ${d ? `in ${shortenToolLabel(d, 30)}` : ''}`.trim();
    }
    if (toolName === 'glob_files') {
      const p = argValue('pattern');
      if (p) return `${toolName} ${shortenToolLabel(p, 60)}`;
    }
    if (toolName === 'ast_grep' || toolName === 'ast_edit') {
      const p = argValue('pattern');
      if (p) return `${toolName} ${shortenToolLabel(p, 60)}`;
    }
    if (toolName === 'apply_patch') {
      const p = argValue('patch') ?? argValue('diff') ?? argValue('content');
      if (p) return `${toolName} ${shortenToolLabel(String(p).split('\n')[0], 80)}`;
    }
    if (toolName === 'websearch' || toolName === 'web_search') {
      const q = argValue('query');
      if (q) return `${toolName} ${shortenToolLabel(q, 60)}`;
    }
    if (toolName === 'todowrite') {
      return `${toolName}`;
    }

    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const parts = [];
      for (const [k, v] of Object.entries(parsed)) {
        if (k.startsWith('_')) continue;
        if (v === null || v === undefined) continue;
        if (typeof v === 'object') continue;
        parts.push(`${k}=${typeof v === 'string' ? shortenToolLabel(v, 40) : JSON.stringify(v)}`);
      }
      if (parts.length > 0) return `${toolName} ${parts.join(' ')}`;
    }

    return toolName;
  }

  function renderToolItem(tool) {
    const status = tool.status === 'result' ? 'done' : tool.status === 'called' ? 'running' : tool.status;
    const cls = status === 'done' ? 'done' : status === 'error' ? 'error' : status === 'waiting' ? 'waiting' : 'running';
    const command = formatToolCommand(tool.name, tool.args);
    console.debug('[tool-render]', tool.name, status, 'id:', tool.id, 'args:', JSON.stringify(tool.args));
    const result = tool.result || '';
    const resultHtml = result
      ? `<pre class="tool-item-output">${escapeHtml(result)}</pre>`
      : (cls === 'running' ? `<pre class="tool-item-output tool-item-output-pending">running…</pre>` : '');

    let statusHtml;
    if (status === 'done') statusHtml = '<span class="tool-item-status done">✓</span>';
    else if (status === 'error') statusHtml = '<span class="tool-item-status error">✗</span>';
    else if (status === 'waiting') statusHtml = '<span class="tool-item-status waiting">⏸</span>';
    else statusHtml = '<span class="tool-item-spinner"></span>';

    return `<div class="tool-item ${cls}">
      <div class="tool-item-header" onclick="this.parentElement.querySelector('.tool-item-body').classList.toggle('collapsed')">
        <span class="tool-item-prompt">$</span>
        <span class="tool-item-cmd">${escapeHtml(command)}</span>
        ${statusHtml}
      </div>
      <div class="tool-item-body collapsed">${resultHtml}</div>
    </div>`;
  }

  function formatToolCall(toolName, args) {
    return formatToolCommand(toolName, args);
  }

  function showWriteTopicPrompt(docType, originalText) {
    const existing = document.getElementById('write-topic-prompt');
    if (existing) existing.remove();

    const promptEl = document.createElement('div');
    promptEl.id = 'write-topic-prompt';
    promptEl.className = 'write-topic-prompt';
    const labelText = docType === 'patent' ? '撰写专利' : '撰写论文';
    const placeholder = docType === 'patent' ? '例如：一种基于梯度孔隙结构的气体扩散层' : '例如：区块链可扩展性 — 一层与二层方案的对比分析';
    promptEl.innerHTML = `
      <div class="write-topic-content">
        <div class="write-topic-header">
          <span class="write-topic-icon">📝</span>
          <div class="write-topic-title">${labelText}需要标题</div>
        </div>
        <div class="write-topic-hint">你说的是 "${escapeHtml(originalText)}"，缺少标题。请输入 ${docType === 'patent' ? '专利' : '论文'} 标题，确认后将进入增量写作流程（最多 20 轮自动撰写）。</div>
        <div class="write-topic-form">
          <input type="text" class="write-topic-input" placeholder="${placeholder}" autofocus />
          <button class="write-topic-confirm">开始撰写</button>
          <button class="write-topic-cancel">取消</button>
        </div>
      </div>
    `;

    let target = currentContentEl;
    if (!target) {
      const lastMsg = messagesContainer.querySelector('.message:last-child .message-content');
      target = lastMsg;
    }
    if (target) {
      target.appendChild(promptEl);
    } else {
      messagesContainer.appendChild(promptEl);
    }
    scrollToBottom();

    const input = promptEl.querySelector('.write-topic-input');
    const confirmBtn = promptEl.querySelector('.write-topic-confirm');
    const cancelBtn = promptEl.querySelector('.write-topic-cancel');

    const submit = () => {
      const topic = (input.value || '').trim();
      if (!topic) {
        input.focus();
        input.classList.add('write-topic-input-error');
        return;
      }
      promptEl.remove();
      vscode.postMessage({ type: 'write-topic-confirm', docType, topic, originalText });
    };
    const cancel = () => {
      promptEl.remove();
      vscode.postMessage({ type: 'write-topic-cancel', originalText });
    };

    confirmBtn.addEventListener('click', submit);
    cancelBtn.addEventListener('click', cancel);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    });
    setTimeout(() => input.focus(), 50);
  }

  function showToolApproval(id, toolName, args, metadata, bashIntent) {
    pendingApproval = { id, toolName, args };

    if (!currentMessageEl) return;

    let toolsSection = currentMessageEl.querySelector('.tool-section');
    if (!toolsSection) {
      toolsSection = document.createElement('div');
      toolsSection.className = 'tool-section';
      currentMessageEl.insertBefore(toolsSection, currentContentEl);
    }

    window.__lastApprovalArgs = args;
    const existingTool = messageState.tools.find(t => t.name === toolName && (t.status === 'running' || t.status === 'waiting'));
    if (!existingTool) {
      messageState.tools.push({ name: toolName, status: 'waiting', result: '', args });
    } else {
      existingTool.status = 'waiting';
      if (args !== undefined) existingTool.args = args;
    }
    renderToolBadges();

    const isDangerous = metadata?.dangerous || bashIntent?.risk === 'high';
    const approvalEl = document.createElement('div');
    approvalEl.className = 'tool-approval-prompt' + (isDangerous ? ' dangerous' : '');
    approvalEl.id = `approval-${id}`;

    const parsedArgs = typeof args === 'string' ? tryParseArgs(args) : args;
    let argsHtml = '';
    if (parsedArgs && typeof parsedArgs === 'object') {
      const entries = Object.entries(parsedArgs);
      if (entries.length > 0) {
        const parts = [];
        for (const [k, v] of entries) {
          const val = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
          const truncated = val.length > 10 ? val.substring(0, 10) + '…' : val;
          parts.push(`<div class="tool-approval-arg"><strong>${escapeHtml(k)}:</strong> <span>${escapeHtml(truncated)}</span></div>`);
        }
        argsHtml = `<div class="tool-approval-args">${parts.join('')}</div>`;
      }
    }

    const icon = isDangerous ? '⚠️' : '⚠';
    const categoryLabel = metadata?.category ? `<span class="tool-approval-category">${escapeHtml(metadata.category)}</span>` : '';
    const description = metadata?.description ? `<div class="tool-approval-description">${escapeHtml(metadata.description)}</div>` : '';

    let intentHtml = '';
    if (bashIntent) {
      const riskClass = bashIntent.risk === 'high' ? 'risk-high' : bashIntent.risk === 'medium' ? 'risk-medium' : 'risk-low';
      intentHtml = `
        <div class="tool-approval-intent ${riskClass}">
          <div class="tool-approval-intent-action">Will <strong>${escapeHtml(bashIntent.action)}</strong></div>
          <div class="tool-approval-intent-target">${escapeHtml(bashIntent.target)}</div>
        </div>
      `;
    }

    const toolCallFormatted = formatToolCall(toolName, parsedArgs);

    approvalEl.innerHTML = `
      <div class="tool-approval-content">
        <div class="tool-approval-header">
          <span class="tool-approval-icon">${icon}</span>
          <div class="tool-approval-title">
            <strong>${escapeHtml(toolName)}</strong> ${categoryLabel}
          </div>
        </div>
        <div class="tool-approval-call">
          <code>${escapeHtml(toolCallFormatted)}</code>
        </div>
        ${description}
        ${intentHtml}
        ${argsHtml}
        <div class="tool-approval-buttons">
          <label class="tool-approval-remember"><input type="checkbox" id="remember-${id}"> 记住此工具</label>
          <div>
            <button class="tool-approval-btn allow" onclick="window.__approveTool('${id}')">Allow</button>
            <button class="tool-approval-btn deny" onclick="window.__denyTool('${id}')">Deny</button>
          </div>
        </div>
      </div>
    `;

    toolsSection.appendChild(approvalEl);
    scrollToBottom();
  }

  window.__approveTool = function(id) {
    const remember = document.getElementById(`remember-${id}`)?.checked === true;
    vscode.postMessage({ type: 'tool-approval', id, approved: true, remember });
    const el = document.getElementById(`approval-${id}`);
    if (el) el.remove();
    const approvalArgs = pendingApproval?.args;
    pendingApproval = null;
    const tool = messageState.tools.find(t => t.status === 'waiting');
    if (tool) {
      tool.status = 'running';
      if (!tool.args && approvalArgs) tool.args = approvalArgs;
    }
    renderToolBadges();
  };

window.__denyTool = function(id) {
    vscode.postMessage({ type: 'tool-approval', id, approved: false });
    const el = document.getElementById(`approval-${id}`);
    if (el) el.remove();
    pendingApproval = null;
    const tool = messageState.tools.find(t => t.status === 'waiting');
    if (tool) {
      tool.status = 'error';
      tool.result = 'Denied by user';
    }
    renderToolBadges();
  }

  function showRateLimited(messageId, retryAfter) {
    const msgEl = document.getElementById(messageId);
    if (!msgEl) return;

    const contentEl = msgEl.querySelector('.message-content');
    if (!contentEl) return;

    contentEl.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'rate-limited-box';
    wrapper.id = `rate-limited-${messageId}`;
    wrapper.innerHTML = `
      <div class="rate-limited-icon">⏳</div>
      <div class="rate-limited-text">
        <div class="rate-limited-title">Rate Limited (429)</div>
        <div class="rate-limited-countdown">Retrying in <span id="rate-countdown-${messageId}">${retryAfter}</span>s…</div>
      </div>`;
    const retryBtn = document.createElement('button');
    retryBtn.className = 'rate-limited-retry-btn';
    retryBtn.textContent = 'Retry Now';
    retryBtn.addEventListener('click', () => {
      console.log('[WEBVIEW] Retry Now clicked', messageId);
      wrapper.style.display = 'none';
      vscode.postMessage({ type: 'rate-limited-retry', messageId });
    });
    wrapper.appendChild(retryBtn);
    contentEl.appendChild(wrapper);
    scrollToBottom();
  }

  function updateRateLimitedTick(messageId, remaining) {
    const countdownEl = document.getElementById(`rate-countdown-${messageId}`);
    if (!countdownEl) return;

    if (remaining <= 1) {
      const box = document.getElementById(`rate-limited-${messageId}`);
      if (box) box.style.display = 'none';
    } else {
      countdownEl.textContent = remaining;
    }
  }

  function ensureReasoningSection() {
    if (!messageState.reasoningVisible) {
      messageState.reasoningVisible = true;
      if (!currentMessageEl) return;
      const reasoningSection = currentMessageEl.querySelector('.reasoning-section');
      if (reasoningSection) {
        reasoningSection.style.display = '';
        const contentEl = reasoningSection.querySelector('.reasoning-content');
        if (contentEl) {
          contentEl.classList.remove('collapsed');
        }
      }
    }
  }

  function addInsertButtons() {
    if (!currentContentEl) return;
    const codeBlocks = currentContentEl.querySelectorAll('pre');
    codeBlocks.forEach((block) => {
      if (block.querySelector('.insert-btn')) return;
      const code = block.textContent || '';
      if (code.includes('#') || code.includes('=') || code.includes('let ') || code.includes('import')) {
        const btn = document.createElement('button');
        btn.className = 'insert-btn';
        btn.textContent = 'Insert as cell';
        btn.onclick = () => {
          vscode.postMessage({
            type: 'insertCell',
            cellType: 'markdown',
            content: code,
          });
        };
        block.appendChild(document.createElement('br'));
        block.appendChild(btn);
      }
    });
  }

  function finalizeMessage() {
    isGenerating = false;
    // Only reset button if no queued messages
    if (messageQueue.length === 0) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
      sendBtn.classList.remove('stop-btn');
      sendBtn.onclick = sendMessage;
    }

    if (thinkingIntervalId) {
      clearInterval(thinkingIntervalId);
      thinkingIntervalId = null;
    }

    for (const tool of messageState.tools) {
      if (tool.status === 'running') {
        tool.status = 'done';
        if (!tool.result) tool.result = 'Completed';
      }
    }
    for (const tool of messageState.toolLog) {
      if (tool.status === 'running') {
        tool.status = 'done';
        if (!tool.result) tool.result = 'Completed';
      }
    }
    renderToolBadges();

    addInsertButtons();

    // Flush any pending text rAF so the latest buffered tokens are rendered
    if (textRafId !== null) {
      cancelAnimationFrame(textRafId);
      textRafId = null;
      if (currentContentEl && messageState.content) {
        currentContentEl.innerHTML = formatContent(messageState.content);
      }
    }

    // Render mermaid diagrams in the completed message
    if (currentMessageEl) {
      renderMermaidDiagrams(currentMessageEl).catch(() => {});
    }

    messageState.content = '';
    messageState.reasoning = '';
    messageState.tools = [];
    messageState.toolLog = [];
    currentMessageEl = null;
    currentContentEl = null;
    currentReasoningContentEl = null;
    currentToolsEl = null;
  }

  let autoRetryTimer = null;
  let autoRetryCountdown = 15;
  let autoRetryAttempt = 0;
  const MAX_AUTO_RETRIES = 3;
  let isRetrying = false;

  function isNonRetryableError(text) {
    if (!text) return true;
    const trimmed = String(text).trim();
    if (!trimmed) return true;
    const t = trimmed.toLowerCase();
    if (t.includes('not support such call')) return true;
    if (t.includes('please follow openai tool')) return true;
    if (t.includes('tool_call_format') || t.includes('toolcall format')) return true;
    if (t.includes('schema') && t.includes('invalid')) return true;
    if (t.includes('function name') && t.includes('not')) return true;
    if (t.includes('unknown tool')) return true;
    if (t.includes('tool_use_failed') || t.includes('tool use failed')) return true;
    if (t.includes('malformed tool')) return true;
    if (t.includes('error parsing tool')) return true;
    if (t.includes('unexpected end of json') || t.includes('unexpected token')) return true;
    if (t.includes('connectionclosed') && t.includes('downstream')) return true;
    if (t.includes('prematurely before response body')) return true;
    if (t.includes('hook abort') || t.includes('hook aborted')) return true;
    if (t.includes('before_tool_call aborted') || t.includes('before tool call aborted')) return true;
    if (t.includes('permission denied') && !t.includes('rate')) return true;
    if (t === 'undefined' || t === 'null' || t === 'error' || t === '[object object]') return true;
    if (t.includes('context_length_exceeded')) return true;
    if (t.includes('maximum context length')) return true;
    if (t.includes('invalid api key')) return true;
    if (t.includes('incorrect api key')) return true;
    if (t.includes('authentication')) return true;
    if (t.includes('model_not_found')) return true;
    if (t.includes('model does not exist')) return true;
    if (t.includes('stream ended') || t.includes('stream closed') || t.includes('stream cut')) return true;
    if (t.includes('sse') && t.includes('closed')) return true;
    if (t.includes('aborted') && !t.includes('rate')) return true;
    return false;
  }

  function stopThinking() {
    if (thinkingIntervalId) {
      clearInterval(thinkingIntervalId);
      thinkingIntervalId = null;
    }
    const wi = currentMessageEl?.querySelector('.waiting-indicator');
    if (wi) wi.remove();
  }

  function showError(messageId, errorText) {
    stopThinking();
    if (autoRetryTimer) {
      clearInterval(autoRetryTimer);
      autoRetryTimer = null;
    }

    function stopAutoRetry(mid, errText) {
      if (autoRetryTimer) {
        clearInterval(autoRetryTimer);
        autoRetryTimer = null;
      }
      isRetrying = false;
      if (messageQueue.length === 0) {
        sendBtn.disabled = false;
        sendBtn.textContent = '➤';
        sendBtn.classList.remove('stop-btn');
        sendBtn.onclick = sendMessage;
      }
      sendBtn.onclick = sendMessage;
      const existing = document.getElementById(`retry-btn-${mid}`);
      if (existing) existing.remove();
      const existingStop = document.getElementById(`retry-stop-${mid}`);
      if (existingStop) existingStop.remove();
      const capMsg = document.createElement('div');
      capMsg.className = 'error-banner';
      capMsg.innerHTML = `<span>已达到最大自动重试次数 (${MAX_AUTO_RETRIES})。请检查网络或 API 配额后手动重试。${errText ? '<br><small>' + escapeHtml(errText) + '</small>' : ''}</span>`;
      if (currentContentEl) {
        currentContentEl.appendChild(capMsg);
      } else {
        const msgEl = document.getElementById(mid);
        if (msgEl) {
          const contentDiv = msgEl.querySelector('.message-content');
          if (contentDiv) contentDiv.appendChild(capMsg);
        }
      }
    }

    if (isNonRetryableError(errorText)) {
      finalizeMessage();
      appendErrorBanner(messageId, errorText);
      return;
    }

    // Panel exhausted its retries → reset UI, show error but don't re-retry
    if (errorText && errorText.includes('已达到最大重试次数')) {
      finalizeMessage();
      appendErrorBanner(messageId, errorText);
      return;
    }
    autoRetryCountdown = 15;
    isRetrying = true;
    autoRetryAttempt = 0;

    for (const tool of messageState.tools) {
      if (tool.status === 'running') {
        tool.status = 'error';
        tool.result = errorText || 'Stream interrupted';
      }
    }
    for (const tool of messageState.toolLog) {
      if (tool.status === 'running') {
        tool.status = 'error';
        tool.result = errorText || 'Stream interrupted';
      }
    }
    renderToolBadges();

    const doRetry = () => {
      if (autoRetryTimer) {
        clearInterval(autoRetryTimer);
        autoRetryTimer = null;
      }
      isRetrying = false;
      const errorBanners = messagesContainer.querySelectorAll('.error-banner');
      errorBanners.forEach(b => b.remove());
      if (lastUserMessageText) {
        vscode.postMessage({ type: 'userMessage', text: lastUserMessageText });
      }
    };

    const startCountdown = () => {
      if (autoRetryAttempt >= MAX_AUTO_RETRIES) {
        stopAutoRetry(messageId, errorText);
        return;
      }
      autoRetryTimer = setInterval(() => {
        autoRetryCountdown--;
        if (autoRetryCountdown <= 0) {
          clearInterval(autoRetryTimer);
          autoRetryTimer = null;
          autoRetryAttempt++;
          if (autoRetryAttempt >= MAX_AUTO_RETRIES) {
            stopAutoRetry(messageId, errorText);
            return;
          }
          doRetry();
        } else {
          const retryBtn = document.getElementById(`retry-btn-${messageId}`);
          if (autoRetryCountdown <= 1 && retryBtn) {
            retryBtn.style.display = 'none';
          } else if (retryBtn) {
            retryBtn.textContent = `Retry(${autoRetryCountdown}s)`;
          }
        }
      }, 1000);
    };

    if (errorText && (errorText.includes('Hook abort') || errorText.includes('PERMISSION_DENIED') || errorText.includes('blocked by permission policy'))) {
      sendBtn.disabled = false;
      sendBtn.textContent = '➤';
      sendBtn.classList.remove('stop-btn');
      if (currentContentEl) {
        const errorEl = document.createElement('div');
        errorEl.className = 'error-inline';
        errorEl.textContent = errorText;
        currentContentEl.appendChild(errorEl);
      } else {
        const errorBanner = document.createElement('div');
        errorBanner.className = 'error-banner';
        errorBanner.innerHTML = `<span>${errorText}</span>`;
        messagesContainer.appendChild(errorBanner);
      }
      return;
    }

    const retryContainer = document.createElement('div');
    retryContainer.className = 'retry-container';
    retryContainer.innerHTML = `<button id="retry-btn-${messageId}" class="retry-btn-inline">Retry(${autoRetryCountdown}s)</button>`;

    if (currentContentEl) {
      currentContentEl.appendChild(retryContainer);
    } else {
      const msgEl = document.getElementById(messageId);
      if (msgEl) {
        const contentDiv = msgEl.querySelector('.message-content');
        if (contentDiv) contentDiv.appendChild(retryContainer);
      }
    }

    setTimeout(() => {
      const retryBtn = document.getElementById(`retry-btn-${messageId}`);
      if (retryBtn) {
        retryBtn.onclick = () => {
          if (autoRetryTimer) {
            clearInterval(autoRetryTimer);
            autoRetryTimer = null;
          }
          isRetrying = false;
          retryBtn.textContent = 'Retry';
          retryBtn.onclick = doRetry;
        };
      }
    }, 0);

    sendBtn.disabled = true;
    sendBtn.classList.add('stop-btn');
    startCountdown();
  }

  function appendErrorBanner(messageId, errorText) {
    const msgEl = document.getElementById(messageId);
    if (!msgEl) return;
    const capMsg = document.createElement('div');
    capMsg.className = 'error-banner';
    capMsg.innerHTML = `<span>${escapeHtml(errorText)}</span>`;
    const contentDiv = msgEl.querySelector('.message-content');
    if (contentDiv) contentDiv.appendChild(capMsg);
  }

  function clearWelcome() {
    const w = document.getElementById('welcome-msg');
    if (w) w.remove();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  function tryParseArgs(s) {
    try { return JSON.parse(s); } catch { return {}; }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

function formatContent(text) {
    if (!text) return '';

    // Extract skill tags before markdown parsing
    let skillContent = '';
    let userTask = '';
    text = text.replace(/<trinno_skill>\n?([\s\S]*?)\n?<\/trinno_skill>\n?/g, (_, content) => {
      skillContent = content.trim();
      return '';
    });

    text = text.replace(/---\n?\*\*Current task:\*\*\s*(.+)$/m, (_, task) => {
      userTask = task.trim();
      return '';
    });

    // Parse markdown to HTML using marked (mermaid/SVG handled by custom renderer)
    let html = '';
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
      html = marked.parse(text);
    } else {
      // Fallback: escape and do basic replacements
      html = escapeHtml(text);
    }

    // Sanitize HTML: remove script tags and event handlers
    html = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
    html = html.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');

    // Add skill badge if present
    if (skillContent) {
      html = `<div class="skill-badge">Skill Applied</div>` + html;
    }

    // Add task footer if present
    if (userTask) {
      html += `<div class="task-footer"><strong>Task:</strong> ${escapeHtml(userTask)}</div>`;
    }

    return html;
  }

  async function renderMermaidDiagrams(container) {
    if (typeof mermaid === 'undefined') return;
    
    const mermaidContainers = container.querySelectorAll('.mermaid-container');
    for (const mc of mermaidContainers) {
      const sourceEl = mc.querySelector('.mermaid-source');
      const diagramEl = mc.querySelector('.mermaid-target');
      
      if (sourceEl && diagramEl && !diagramEl.getAttribute('data-rendered')) {
        const code = sourceEl.textContent;
        try {
          const { svg } = await mermaid.render('mermaid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8), code);
          // mermaid may return an error SVG instead of throwing
          if (/error-icon|error-text|class="error[^"]*"|Syntax error|parse error/i.test(svg)) {
            throw new Error();
          }
          diagramEl.innerHTML = svg;
          diagramEl.setAttribute('data-rendered', 'true');
          sourceEl.style.display = 'none';
        } catch {
          diagramEl.innerHTML = `<pre class="mermaid-source" style="white-space:pre-wrap">${escapeHtml(code)}</pre>`;
          diagramEl.setAttribute('data-rendered', 'error');
          sourceEl.remove();
        }
      }
    }
  }
})();
