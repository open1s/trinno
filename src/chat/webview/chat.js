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

  // Initialize Mermaid
  if (typeof mermaid !== 'undefined') {
    mermaid.initialize({ 
      startOnLoad: false,
      theme: 'default',
      securityLevel: 'loose'
    });
  }

  let currentMessageEl = null;
  let currentContentEl = null;
  let currentReasoningContentEl = null;
  let currentToolsEl = null;
  let currentToolsLogEl = null;
  let isGenerating = false;
  let pendingRetry = null;
  let lastUserMessageText = '';
  let personaName = 'Research Assistant';
  let currentSessionId = '';
  let currentSessionTitle = '';
  let sessions = [];
  let isCompacted = false;
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
  const vscode = acquireVsCodeApi();

  let slashCommands = [
    { name: 'session', description: 'Manage sessions: list, select, delete, rename' },
    { name: 'new', description: 'Create a new chat session' },
    { name: 'compact', description: 'Compact current session: summarize old messages, reduce context' },
    { name: 'ai-research', description: 'AI-driven research: auto-extracts keywords, searches, summarizes, TRIZ report' },
    { name: 'research', description: 'Full TRIZ research: contradiction + prior art + S-curve + TRL' },
    { name: 'contradiction', description: 'Analyze technical contradictions using TRIZ matrix' },
    { name: 'search', description: 'Search patents, papers, and technical solutions' },
    { name: 's-curve', description: 'Technology maturity S-curve analysis with TRL' },
    { name: 'ideality', description: 'Evaluate system ideality (benefits/costs/harms)' },
    { name: 'principles', description: 'List or search the 40 TRIZ inventive principles' },
    { name: 'su-field', description: 'Substance-Field model analysis' },
    { name: 'help', description: 'Show all available commands' },
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

  function updateMcpStatus() {
    if (!statusMcpEl) return;
    if (mcpServers.length === 0) {
      statusMcpEl.innerHTML = '';
      if (mcpDropdownEl) mcpDropdownEl.classList.remove('visible');
      return;
    }
    const connected = mcpServers.filter(s => s.connected);
    const label = connected.length > 0
      ? `&#9654; MCP (${connected.length})`
      : `&#9654; MCP (0)`;
    statusMcpEl.innerHTML = `<span class="mcp-label">${label}</span>`;

    statusMcpEl.onclick = (e) => {
      e.stopPropagation();
      mcpDropdownVisible = !mcpDropdownVisible;
      if (mcpDropdownVisible) {
        renderMcpDropdown();
        mcpDropdownEl.classList.add('visible');
      } else {
        mcpDropdownEl.classList.remove('visible');
      }
    };

    if (mcpDropdownVisible) {
      renderMcpDropdown();
    }
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

  function handleCopyOnSelect() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const selectedText = selection.toString().trim();
    if (!selectedText) return;

    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const msgEl = container.nodeType === 1 ? container : container.parentElement;
    const messageDiv = msgEl?.closest?.('.message');

    if (messageDiv) {
      const contentEl = messageDiv.querySelector('.message-content');
      const reasoningEl = messageDiv.querySelector('.reasoning-content');
      let fullText = '';

      if (reasoningEl && reasoningEl.textContent.trim()) {
        fullText += `## Thinking\n${reasoningEl.textContent.trim()}\n\n`;
      }
      if (contentEl) {
        fullText += contentEl.textContent.trim();
      }

      if (fullText) {
        navigator.clipboard.writeText(fullText).catch(() => {});
      }
    } else {
      navigator.clipboard.writeText(selectedText).catch(() => {});
    }
  }

  function handleInputKeydown(e) {
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

    if (e.key === 'Enter' && !e.shiftKey && !completionVisible) {
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
      const prefix = slashMatch[1].toLowerCase();
      filteredCommands = slashCommands.filter(c => c.name.toLowerCase().includes(prefix));
      if (filteredCommands.length > 0) {
        completionIndex = 0;
        showCompletion();
      } else {
        hideCompletion();
      }
    } else {
      hideCompletion();
    }
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
    const errorBanners = messagesContainer.querySelectorAll('.error-banner');
    errorBanners.forEach(b => b.remove());
    hideCompletion();
    const text = inputEl.value.trim();
    const attText = getAttachmentText();
    const fullText = attText ? (text ? attText + '\n\n' + text : attText) : text;
    if (!fullText || isGenerating) return;
    lastUserMessageText = fullText;
    inputEl.value = '';
    clearAttachments();
    autoResize();
    vscode.postMessage({ type: 'userMessage', text: fullText });
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
        updateStatusBar();
        showWelcome(msg.context);
        break;

      case 'streaming-start':
        startAssistantMessage(msg.messageId);
        break;

      case 'token':
        appendToken(msg.tokenType, msg.text);
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

      case 'tool-approval-needed':
        showToolApproval(msg.id, msg.toolName, msg.args);
        break;

      case 'rate-limited':
        showRateLimited(msg.messageId, msg.retryAfter);
        break;

      case 'rate-limited-tick':
        updateRateLimitedTick(msg.messageId, msg.remaining);
        break;
    }
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
        ${message.reasoning ? `<div class="reasoning-section"><div class="reasoning-header"> Thinking <span class="reasoning-hint">[click to expand]</span></div><div class="reasoning-content collapsed">${escapeHtml(message.reasoning)}</div></div>` : ''}
        ${message.toolCalls && message.toolCalls.length > 0 ? renderToolLog(message.toolCalls) : ''}
        <div class="message-content">${formatContent(message.content)}</div>
      `;
    }
    messagesContainer.appendChild(el);
    
    // Render mermaid diagrams in history messages
    renderMermaidDiagrams(el).catch(() => {});
  }

  function renderToolLog(tools) {
    if (!tools || tools.length === 0) return '';
    const doneCount = tools.filter(t => t.status === 'done').length;
    const runningCount = tools.filter(t => t.status === 'running').length;
    const errorCount = tools.filter(t => t.status === 'error').length;

    let html = `<div class="tool-section">`;
    html += `<div class="tool-summary" onclick="this.parentElement.querySelector('.tool-log').classList.toggle('collapsed')">`;
    html += `<span class="tool-count">${doneCount} done`;
    if (runningCount > 0) html += `, ${runningCount} running`;
    if (errorCount > 0) html += `, ${errorCount} failed`;
    html += `</span><span class="tool-toggle">▼</span></div>`;
    html += `<div class="tool-log collapsed">`;
    for (const t of tools) {
      const cls = t.status === 'done' ? 'done' : t.status === 'error' ? 'error' : 'running';
      html += `<div class="tool-log-item ${cls}"><span class="tool-log-name">${escapeHtml(t.name)}</span>`;
      if (t.status === 'done') html += `<span class="tool-log-status">✓</span>`;
      else if (t.status === 'error') html += `<span class="tool-log-status">✗</span>`;
      else html += `<span class="tool-log-spinner"></span>`;
      if (t.result) html += `<div class="tool-log-result">${escapeHtml(t.result.slice(0, 200))}${t.result.length > 200 ? '...' : ''}</div>`;
      html += `</div>`;
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
    sendBtn.disabled = true;
    sendBtn.textContent = '■';
    sendBtn.classList.add('stop-btn');
    sendBtn.onclick = cancelGeneration;

    messageState.content = '';
    messageState.reasoning = '';
    messageState.reasoningVisible = false;
    messageState.tools = [];
    messageState.toolLog = [];

    currentMessageEl = document.createElement('div');
    currentMessageEl.className = 'message assistant';

    const reasoningSection = document.createElement('div');
    reasoningSection.className = 'reasoning-section';
    reasoningSection.style.display = 'none';
    reasoningSection.innerHTML = `
      <div class="reasoning-header">
        Thinking <span class="reasoning-hint">[click to expand]</span>
      </div>
      <div class="reasoning-content collapsed"></div>
    `;
    currentMessageEl.appendChild(reasoningSection);
    currentReasoningContentEl = reasoningSection.querySelector('.reasoning-content');

    const waitingIndicator = document.createElement('div');
    waitingIndicator.className = 'waiting-indicator';
    waitingIndicator.innerHTML = '<span class="waiting-dots">Thinking</span>';
    currentMessageEl.appendChild(waitingIndicator);

    currentContentEl = document.createElement('div');
    currentContentEl.className = 'message-content';
    currentContentEl.style.display = 'none';
    currentMessageEl.appendChild(currentContentEl);

    messagesContainer.appendChild(currentMessageEl);
  }

  function appendToken(tokenType, text) {
    if (!currentContentEl) return;

    const waitingIndicator = currentMessageEl?.querySelector('.waiting-indicator');
    if (waitingIndicator) {
      waitingIndicator.remove();
      currentContentEl.style.display = '';
    }

    switch (tokenType) {
      case 'ReasoningContent':
        ensureReasoningSection();
        messageState.reasoning += text;
        if (currentReasoningContentEl) {
          currentReasoningContentEl.textContent = messageState.reasoning;
        }
        break;

      case 'Text':
        messageState.content += text;
        currentContentEl.innerHTML = formatContent(messageState.content);
        renderMermaidDiagrams(currentContentEl).catch(() => {});
        addInsertButtons();
        break;

      case 'ToolCall':
        const toolName = text.trim();
        if (!toolName) break;

        const existingTool = messageState.tools.find(t => t.name === toolName && (t.status === 'running' || t.status === 'waiting'));
        if (existingTool) break;

        messageState.tools.push({ name: toolName, status: 'running', result: '' });
        messageState.toolLog.push({ name: toolName, status: 'running' });
        renderToolBadges();
        break;

      case 'ToolResult':
        const lastRunning = [...messageState.tools].reverse().find(t => t.status === 'running');
        if (lastRunning) {
          const isDenied = text && (text.includes('PERMISSION_DENIED') || text.includes('denied by user') || text.includes('User denied'));
          lastRunning.status = isDenied ? 'error' : 'done';
          lastRunning.result = text || '';
        }
        const lastLog = [...messageState.toolLog].reverse().find(t => t.status === 'running');
        if (lastLog) {
          const isDenied2 = text && (text.includes('PERMISSION_DENIED') || text.includes('denied by user') || text.includes('User denied'));
          lastLog.status = isDenied2 ? 'error' : 'done';
          lastLog.result = text || '';
        }
        renderToolBadges();
        break;
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
    const runningCount = messageState.tools.filter(t => t.status === 'running').length;
    const totalCount = messageState.tools.length;

    if (totalCount === 0) {
      toolsSection.innerHTML = '';
      return;
    }

    let html = `<div class="tool-summary" onclick="this.parentElement.querySelector('.tool-log').classList.toggle('collapsed')">`;
    html += `<span class="tool-count">`;
    if (runningCount > 0) {
      html += `<span class="tool-spinner-inline"></span> `;
    }
    html += `${doneCount}/${totalCount} tools`;
    if (runningCount > 0) html += ` (${runningCount} running)`;
    html += `</span><span class="tool-toggle">▼</span></div>`;

    html += `<div class="tool-log">`;
    for (const t of messageState.tools) {
      const cls = t.status === 'done' ? 'done' : t.status === 'error' ? 'error' : 'running';
      html += `<div class="tool-log-item ${cls}">`;
      html += `<span class="tool-log-name">${escapeHtml(t.name)}</span>`;
      if (t.status === 'done') html += `<span class="tool-log-status">✓</span>`;
      else if (t.status === 'error') html += `<span class="tool-log-status">✗</span>`;
      else html += `<span class="tool-log-spinner"></span>`;
      if (t.result) {
        const preview = t.result.length > 150 ? t.result.slice(0, 150) + '...' : t.result;
        html += `<div class="tool-log-result">${escapeHtml(preview)}</div>`;
      }
      html += `</div>`;
    }
    html += `</div>`;

    toolsSection.innerHTML = html;
  }

  function showToolApproval(id, toolName, args) {
    pendingApproval = { id, toolName, args };

    if (!currentMessageEl) return;

    let toolsSection = currentMessageEl.querySelector('.tool-section');
    if (!toolsSection) {
      toolsSection = document.createElement('div');
      toolsSection.className = 'tool-section';
      currentMessageEl.insertBefore(toolsSection, currentContentEl);
    }

    const existingTool = messageState.tools.find(t => t.name === toolName && (t.status === 'running' || t.status === 'waiting'));
    if (!existingTool) {
      messageState.tools.push({ name: toolName, status: 'waiting', result: '' });
    } else {
      existingTool.status = 'waiting';
    }
    renderToolBadges();

    const approvalEl = document.createElement('div');
    approvalEl.className = 'tool-approval-prompt';
    approvalEl.id = `approval-${id}`;

    let argsHtml = '';
    if (args && typeof args === 'object') {
      const entries = Object.entries(args).slice(0, 3);
      if (entries.length > 0) {
        argsHtml = `<div class="tool-approval-args">${entries.map(([k, v]) => {
          const val = typeof v === 'string' ? v : JSON.stringify(v);
          return `<span><strong>${escapeHtml(k)}:</strong> ${escapeHtml(val.length > 80 ? val.slice(0, 80) + '...' : val)}</span>`;
        }).join('')}</div>`;
      }
    }

    approvalEl.innerHTML = `
      <div class="tool-approval-content">
        <span class="tool-approval-icon">⚠</span>
        <div class="tool-approval-text">
          <strong>${escapeHtml(toolName)}</strong> wants to execute
          ${argsHtml}
        </div>
        <div class="tool-approval-buttons">
          <button class="tool-approval-btn allow" onclick="window.__approveTool('${id}')">Allow</button>
          <button class="tool-approval-btn deny" onclick="window.__denyTool('${id}')">Deny</button>
        </div>
      </div>
    `;

    toolsSection.appendChild(approvalEl);
    scrollToBottom();
  }

  window.__approveTool = function(id) {
    vscode.postMessage({ type: 'tool-approval', id, approved: true });
    const el = document.getElementById(`approval-${id}`);
    if (el) el.remove();
    pendingApproval = null;
    const tool = messageState.tools.find(t => t.status === 'waiting');
    if (tool) tool.status = 'running';
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
    updateToolSection();
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
      </div>
      <button class="rate-limited-retry-btn" onclick="vscode.postMessage({ type: 'rate-limited-retry', messageId: '${messageId}' })">Retry Now</button>
    `;
    contentEl.appendChild(wrapper);
    scrollToBottom();
  }

  function updateRateLimitedTick(messageId, remaining) {
    const countdownEl = document.getElementById(`rate-countdown-${messageId}`);
    if (!countdownEl) return;

    if (remaining <= 0) {
      countdownEl.textContent = '0';
      const box = document.getElementById(`rate-limited-${messageId}`);
      if (box) {
        const btn = box.querySelector('.rate-limited-retry-btn');
        if (btn) btn.textContent = 'Retry';
      }
    } else {
      countdownEl.textContent = remaining;
    }
  }

  function ensureReasoningSection() {
    if (!messageState.reasoningVisible) {
      messageState.reasoningVisible = true;
      const reasoningSection = currentMessageEl.querySelector('.reasoning-section');
      if (reasoningSection) {
        reasoningSection.style.display = '';
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
        btn.textContent = 'Insert as Typst cell';
        btn.onclick = () => {
          vscode.postMessage({
            type: 'insertCell',
            cellType: 'typst',
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
    sendBtn.disabled = false;
    sendBtn.textContent = '➤';
    sendBtn.classList.remove('stop-btn');
    sendBtn.onclick = sendMessage;

    for (const tool of messageState.tools) {
      if (tool.status === 'running') {
        tool.status = 'done';
        tool.result = `${tool.name}: Completed`;
      }
    }
    for (const tool of messageState.toolLog) {
      if (tool.status === 'running') {
        tool.status = 'done';
        tool.result = `${tool.name}: Completed`;
      }
    }
    renderToolBadges();

    addInsertButtons();

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
  let isRetrying = false;

  function showError(messageId, errorText) {
    if (autoRetryTimer) {
      clearInterval(autoRetryTimer);
      autoRetryTimer = null;
    }
    autoRetryCountdown = 15;
    isRetrying = true;

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

    sendBtn.disabled = true;
    sendBtn.textContent = `Retrying (${autoRetryCountdown}s)`;
    sendBtn.classList.add('stop-btn');

    const doRetry = () => {
      if (autoRetryTimer) {
        clearInterval(autoRetryTimer);
        autoRetryTimer = null;
      }
      isRetrying = false;
      // Remove error banners
      const errorBanners = messagesContainer.querySelectorAll('.error-banner');
      errorBanners.forEach(b => b.remove());
      // Resend last message
      if (lastUserMessageText) {
        vscode.postMessage({ type: 'userMessage', text: lastUserMessageText });
      }
    };

    const createRetryBtn = (btn) => {
      btn.className = 'retry-btn';
      btn.textContent = `Retry (${autoRetryCountdown}s)`;
      btn.onclick = doRetry;
      autoRetryTimer = setInterval(() => {
        autoRetryCountdown--;
        if (autoRetryCountdown <= 0) {
          clearInterval(autoRetryTimer);
          autoRetryTimer = null;
          doRetry();
        } else {
          btn.textContent = `Retry (${autoRetryCountdown}s)`;
          sendBtn.textContent = `Retrying (${autoRetryCountdown}s)`;
        }
      }, 1000);
    };

    if (errorText && (errorText.includes('Hook abort') || errorText.includes('PERMISSION_DENIED') || errorText.includes('blocked by permission policy'))) {
      // Do not show retry button for denied tool calls
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
    // Don't call finalizeMessage() - keep UI in retry state
  }

  function clearWelcome() {
    const w = document.getElementById('welcome-msg');
    if (w) w.remove();
  }

  function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
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
    
    // Handle trinno_skill tags before escaping (they contain markdown)
    let skillContent = '';
    let userTask = '';
    text = text.replace(/<trinno_skill>\n?([\s\S]*?)\n?<\/trinno_skill>\n?/g, (_, content) => {
      skillContent = content.trim();
      return '';
    });
    
    // Extract task after --- separator
    text = text.replace(/---\n?\*\*Current task:\*\*\s*(.+)$/m, (_, task) => {
      userTask = task.trim();
      return '';
    });
    
    // Escape HTML
    let html = escapeHtml(text);
    
    // Add skill badge if present
    if (skillContent) {
      html = `<div class="skill-badge">🎯 Skill Applied</div>` + html;
    }
    
    // Mermaid blocks (must be processed before other rules)
    let mermaidCount = 0;
    html = html.replace(/```mermaid\n([\s\S]*?)```/g, (_, mermaidCode) => {
      const id = `mermaid-${++mermaidCount}`;
      return `<div class="mermaid-container" data-mermaid-id="${id}"><pre class="mermaid-source" style="display:none">${escapeHtml(mermaidCode.trim())}</pre><div id="${id}" class="mermaid"></div></div>`;
    });
    
    // SVG blocks
    html = html.replace(/```svg\n([\s\S]*?)```/g, (_, svgContent) => {
      return `<div class="svg-preview">${svgContent.trim()}</div>`;
    });
    
    // Code blocks
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      return `<pre><code class="lang-${lang}">${code.trim()}</code></pre>`;
    });
    
    // Inline code
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Headers
    html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
    
    // Horizontal rules
    html = html.replace(/^---$/gm, '<hr>');
    
    // Blockquotes
    html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
    
    // Bold and italic
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // Links
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    
    // Images (including SVG)
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
      if (src.endsWith('.svg') || src.startsWith('data:image/svg')) {
        return `<img src="${src}" alt="${alt}" class="svg-image">`;
      }
      return `<img src="${src}" alt="${alt}">`;
    });
    
    // Tables - handle various formats
    html = html.replace(/(\|[^\n]+\|)\n(\|[^\n]+\|)\n((?:\|[^\n]+\|\n?)*)/g, (match, header, separator, body) => {
      // Parse header
      const headers = header.split('|').filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join('');
      // Parse body rows
      const rows = body.trim().split('\n').filter(row => row.trim()).map(row => {
        const cells = row.split('|').filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    });
    
    // Unordered lists
    html = html.replace(/^[\s]*[-*+] (.+)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');
    
    // Ordered lists
    html = html.replace(/^[\s]*\d+\. (.+)$/gm, '<li>$1</li>');
    
    // Paragraphs (lines not already wrapped in block elements)
    html = html.replace(/^(?!<[hultbo]|<\/|<hr|<br|<pre|<code|<blockquote|<div|<img|<table)(.+)$/gm, '<p>$1</p>');
    
    // Clean up extra line breaks
    html = html.replace(/<br>\n/g, '\n');
    html = html.replace(/\n<br>/g, '\n');
    
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
      const id = mc.getAttribute('data-mermaid-id');
      const sourceEl = mc.querySelector('.mermaid-source');
      const diagramEl = document.getElementById(id);
      
      if (sourceEl && diagramEl && !diagramEl.getAttribute('data-rendered')) {
        try {
          const code = sourceEl.textContent;
          const { svg } = await mermaid.render(id, code);
          diagramEl.innerHTML = svg;
          diagramEl.setAttribute('data-rendered', 'true');
          sourceEl.style.display = 'none';
        } catch (err) {
          diagramEl.innerHTML = `<div class="mermaid-error">Failed to render diagram: ${err.message}</div>`;
          sourceEl.style.display = 'block';
        }
      }
    }
  }
})();
