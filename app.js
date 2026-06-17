// TaskOrbit Board Logic

// Core Accent Palette
const BOARD_ACCENTS = ['#8b5cf6', '#10b981', '#f59e0b', '#0ea5e9', '#ef4444', '#ec4899'];

// Main State Object
let state = {
  lists: []
};

// Global Drag & Drop State
let draggedTaskId = null;
let draggedSourceListId = null;
let draggedColumnId = null;
let draggedCardHeight = 0;

// Ticker interval
let tickerInterval = null;

// Repeating chime interval
let chimeRepeatInterval = null;

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  loadState();
  initEventListeners();
  updateSoundUI();
  startGlobalTicker();
  updateStats();
  initAutosave();
});

// Load State from LocalStorage
function loadState() {
  const localData = localStorage.getItem('taskorbit_board_state');
  if (localData) {
    try {
      state = JSON.parse(localData);
      
      // Default sound state to true if undefined
      if (state.soundEnabled === undefined) {
        state.soundEnabled = true;
      }
      
      // Default autosave configuration if undefined
      if (!state.autosave) {
        state.autosave = {
          enabled: true,
          fileEnabled: false,
          folderName: ''
        };
      }
      
      // Ensure timer remaining states are updated based on elapsed time if they were running
      state.lists.forEach(list => {
        list.tasks.forEach(task => {
          if (task.timer && task.timer.state === 'running') {
            const now = Date.now();
            const end = task.timer.endTimeStamp || 0;
            if (end > now) {
              task.timer.remaining = Math.max(0, Math.ceil((end - now) / 1000));
            } else {
              task.timer.remaining = 0;
              task.timer.state = 'completed';
            }
          }
          // Avoid notification spam on startup for historical overdue deadlines
          if (task.dueDate) {
            const dueTime = new Date(task.dueDate).getTime();
            if (Date.now() >= dueTime) {
              task.dueDateAlerted = true;
            }
          }
        });
      });
    } catch (e) {
      console.error("Failed to parse board state, creating default.", e);
      createDefaultBoard();
    }
  } else {
    createDefaultBoard();
  }
  renderBoard();
}

// Create a Default Starter Board
function createDefaultBoard() {
  state.soundEnabled = true;
  state.autosave = {
    enabled: true,
    fileEnabled: false,
    folderName: ''
  };
  state.lists = [
    {
      id: 'list-' + generateId(),
      name: 'To Do',
      tasks: [
        {
          id: 'task-' + generateId(),
          title: 'Welcome to TaskOrbit! 🚀',
          note: 'Double-click the title or note text to edit directly, or drag tasks between columns to reorder.',
          dueDate: getFutureDateTimeString(2),
          timer: { duration: 1500, remaining: 1500, state: 'idle', endTimeStamp: 0 }
        },
        {
          id: 'task-' + generateId(),
          title: 'Try out the task timer ⏱️',
          note: 'Click "+ Add Timer" below to create a countdown, or start the timer on this task to see it run!',
          dueDate: getFutureDateTimeString(1),
          timer: { duration: 300, remaining: 300, state: 'paused', endTimeStamp: 0 }
        }
      ]
    },
    {
      id: 'list-' + generateId(),
      name: 'In Progress',
      tasks: []
    },
    {
      id: 'list-' + generateId(),
      name: 'Done',
      tasks: []
    }
  ];
  saveState();
}

// Save State to LocalStorage
function saveState() {
  localStorage.setItem('taskorbit_board_state', JSON.stringify(state));
  updateStats();
}

// Event Listeners for global actions
function initEventListeners() {

  // Toggle sound button
  const toggleSoundBtn = document.getElementById('toggle-sound-btn');
  if (toggleSoundBtn) {
    toggleSoundBtn.addEventListener('click', () => {
      state.soundEnabled = !state.soundEnabled;
      saveState();
      updateSoundUI();
    });
  }

  // Export session button
  const exportBtn = document.getElementById('export-session-btn');
  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      exportSession();
    });
  }

  // Import session button & file input
  const importBtn = document.getElementById('import-session-btn');
  const importFileInput = document.getElementById('import-session-file');
  if (importBtn && importFileInput) {
    importBtn.addEventListener('click', () => {
      importFileInput.click();
    });
    importFileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        importSession(e.target.files[0]);
        // Reset the value so the same file can be selected again
        e.target.value = '';
      }
    });
  }

  // Modal Dialog setup
  const taskModal = document.getElementById('task-modal');
  const modalForm = taskModal.querySelector('.modal-form');
  const closeModalBtn = document.getElementById('close-modal-btn');
  const modalDeleteBtn = document.getElementById('modal-delete-btn');

  closeModalBtn.addEventListener('click', () => {
    taskModal.close();
  });

  modalDeleteBtn.addEventListener('click', () => {
    const taskId = document.getElementById('modal-task-id').value;
    deleteTask(taskId);
    taskModal.close();
  });

  modalForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveModalTask();
    taskModal.close();
  });

  // Close modal on outside click
  taskModal.addEventListener('click', (e) => {
    const rect = taskModal.getBoundingClientRect();
    const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
      rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
    if (!isInDialog) {
      taskModal.close();
    }
  });

  // Menu Popover Event Listeners
  const menuEditTask = document.getElementById('menu-edit-task');
  const menuDeleteTask = document.getElementById('menu-delete-task');
  const popover = document.getElementById('task-menu-popover');

  menuEditTask.addEventListener('click', () => {
    const taskId = popover.dataset.activeTaskId;
    if (taskId) {
      openTaskModal(taskId);
      popover.hidePopover();
    }
  });

  menuDeleteTask.addEventListener('click', () => {
    const taskId = popover.dataset.activeTaskId;
    if (taskId) {
      deleteTask(taskId);
      popover.hidePopover();
    }
  });

  // Set up board canvas drag over & drop for columns
  const canvas = document.getElementById('board-canvas');
  canvas.addEventListener('dragover', (e) => {
    if (draggedColumnId) {
      e.preventDefault();
      const afterElement = getDragAfterColumnElement(canvas, e.clientX);
      const draggedCol = document.querySelector('.dragging-column');
      const placeholder = canvas.querySelector('.column-placeholder');
      
      if (draggedCol) {
        if (afterElement == null) {
          canvas.insertBefore(draggedCol, placeholder);
        } else {
          canvas.insertBefore(draggedCol, afterElement);
        }
      }
    }
  });

  canvas.addEventListener('drop', (e) => {
    if (draggedColumnId) {
      e.preventDefault();
      const colOrder = [...canvas.querySelectorAll('.board-column')].map(col => col.id);
      state.lists.sort((a, b) => colOrder.indexOf(a.id) - colOrder.indexOf(b.id));
      saveState();
      renderBoard();
    }
  });

  // Focus Overlay Minimizer Button Click
  const minimizeBtn = document.getElementById('focus-btn-minimize');
  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      state.focusOverlayMinimized = !state.focusOverlayMinimized;
      saveState();
      updateFocusOverlay();
    });
  }

  // Focus Overlay Play/Pause Button Click
  const focusToggleBtn = document.getElementById('focus-btn-toggle');
  if (focusToggleBtn) {
    focusToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.activeFocusTaskId) {
        let focusTask = null;
        state.lists.forEach(list => {
          const t = list.tasks.find(tk => tk.id === state.activeFocusTaskId);
          if (t) focusTask = t;
        });
        if (focusTask) {
          toggleTimer(focusTask);
          renderBoard();
        }
      }
    });
  }

  // Focus Overlay Reset/Delete Button Click
  const focusDeleteBtn = document.getElementById('focus-btn-delete');
  if (focusDeleteBtn) {
    focusDeleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (state.activeFocusTaskId) {
        let focusTask = null;
        state.lists.forEach(list => {
          const t = list.tasks.find(tk => tk.id === state.activeFocusTaskId);
          if (t) focusTask = t;
        });
        if (focusTask) {
          deleteTimer(focusTask);
          renderBoard();
        }
      }
    });
  }

  // Alert modal close listener to stop repeating timer chime
  const alertModal = document.getElementById('alert-modal');
  if (alertModal) {
    alertModal.addEventListener('close', () => {
      stopRepeatingChime();
    });
  }

  // Autosave Modal and action bindings
  const autosaveConfigBtn = document.getElementById('autosave-config-btn');
  if (autosaveConfigBtn) {
    autosaveConfigBtn.addEventListener('click', () => {
      openAutosaveModal();
    });
  }

  const autosaveModal = document.getElementById('autosave-modal');
  if (autosaveModal) {
    const autosaveForm = autosaveModal.querySelector('.modal-form');
    const enableCheckbox = document.getElementById('autosave-enable');
    const fileCheckbox = document.getElementById('autosave-file-enable');
    const cancelBtn = document.getElementById('autosave-cancel-btn');

    cancelBtn.addEventListener('click', () => {
      autosaveModal.close();
    });

    autosaveForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const wasFileEnabled = state.autosave ? state.autosave.fileEnabled : false;
      
      state.autosave.enabled = enableCheckbox.checked;
      state.autosave.fileEnabled = fileCheckbox.checked;

      // Handle folder handle cleaning if they disabled file autosave
      if (!state.autosave.fileEnabled) {
        state.autosave.folderName = '';
        await clearFolderHandle();
      } else if (!wasFileEnabled && state.autosave.fileEnabled && !state.autosave.folderName) {
        // If they enabled file autosave but haven't selected a folder yet, alert them
        alert("Please select a folder location for file autosave.");
        return;
      }

      saveState();
      startAutosaveTimer();
      updateAutosaveUI();
      autosaveModal.close();
    });

    // Close on outside click
    autosaveModal.addEventListener('click', (e) => {
      const rect = autosaveModal.getBoundingClientRect();
      const isInDialog = (rect.top <= e.clientY && e.clientY <= rect.top + rect.height &&
        rect.left <= e.clientX && e.clientX <= rect.left + rect.width);
      if (!isInDialog) {
        autosaveModal.close();
      }
    });
  }

  const selectFolderBtn = document.getElementById('autosave-select-folder-btn');
  if (selectFolderBtn) {
    selectFolderBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        if (typeof window.showDirectoryPicker !== 'function') {
          alert("Directory picker is not supported in this browser. Try Chrome or Edge.");
          return;
        }
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        const permission = await handle.requestPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          state.autosave.folderName = handle.name;
          const folderInfo = document.getElementById('autosave-folder-info');
          if (folderInfo) {
            folderInfo.textContent = `Folder: ${handle.name}`;
          }
          await saveFolderHandle(handle);
          saveState();
        } else {
          alert("Permission to write to the folder was denied.");
        }
      } catch (err) {
        if (err.name !== 'AbortError') {
          console.error("Folder selection failed:", err);
          alert("An error occurred during folder selection: " + err.message);
        }
      }
    });
  }
}

// Helper: Generates unique ID
function generateId() {
  return Math.random().toString(36).substring(2, 11);
}

// Helper: Returns future date-time string in YYYY-MM-DDTHH:MM format
function getFutureDateTimeString(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  d.setHours(12, 0, 0, 0);
  
  // Format to local date-time string
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Add New Column (List)
function addNewColumn() {
  const name = prompt("Enter list name:", "New Column");
  if (!name || name.trim() === "") return;

  state.lists.push({
    id: 'list-' + generateId(),
    name: name.trim(),
    tasks: []
  });
  saveState();
  renderBoard();
}

// Render Board Canvas
function renderBoard() {
  const canvas = document.getElementById('board-canvas');
  canvas.innerHTML = '';

  state.lists.forEach((list, index) => {
    const columnColor = BOARD_ACCENTS[index % BOARD_ACCENTS.length];

    const activeTasks = list.tasks.filter(t => !t.completed);
    const completedTasks = list.tasks.filter(t => t.completed);

    const columnEl = document.createElement('div');
    columnEl.className = 'board-column';
    columnEl.id = list.id;
    columnEl.style.setProperty('--column-accent', columnColor);

    // Column Header HTML (using activeTasks.length!)
    columnEl.innerHTML = `
      <div class="column-header">
        <div class="column-title-wrap">
          <div class="column-drag-handle" title="Drag to reorder list">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="9" cy="5" r="1"></circle><circle cx="9" cy="12" r="1"></circle><circle cx="9" cy="19" r="1"></circle><circle cx="15" cy="5" r="1"></circle><circle cx="15" cy="12" r="1"></circle><circle cx="15" cy="19" r="1"></circle></svg>
          </div>
          <button class="column-toggle-btn ${list.incompleteExpanded !== false ? '' : 'collapsed'}" title="Toggle active tasks" aria-label="Toggle active tasks">
            <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <span class="column-title" contenteditable="true" data-list-id="${list.id}">${escapeHtml(list.name)}</span>
          <span class="column-badge">${activeTasks.length}</span>
        </div>
        <div class="column-actions">
          <button class="btn-icon-sm btn-delete-column" data-list-id="${list.id}" title="Delete List">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
      <div class="tasks-container ${list.incompleteExpanded !== false ? '' : 'collapsed'}" data-list-id="${list.id}">
        <!-- Render tasks dynamically -->
      </div>
      <button class="btn-add-task" data-list-id="${list.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
        Add Task
      </button>
    `;

    const tasksContainer = columnEl.querySelector('.tasks-container');
    
    // Add Active Tasks
    activeTasks.forEach(task => {
      const taskCard = createTaskCardElement(task, list.id);
      tasksContainer.appendChild(taskCard);
    });

    // Add Completed Section if tasks exist
    if (completedTasks.length > 0) {
      const completedSection = document.createElement('div');
      completedSection.className = 'completed-section';
      if (list.completedExpanded) {
        completedSection.classList.add('expanded');
      }

      completedSection.innerHTML = `
        <div class="completed-header">
          <button class="completed-toggle-btn">
            <svg class="chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
            <span>Completed (${completedTasks.length})</span>
          </button>
          <button class="completed-clear-btn" title="Delete all completed tasks in this list">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
        <div class="completed-container">
          <!-- Render completed tasks -->
        </div>
      `;

      const completedContainer = completedSection.querySelector('.completed-container');
      completedTasks.forEach(task => {
        const taskCard = createTaskCardElement(task, list.id);
        completedContainer.appendChild(taskCard);
      });

      // Toggle expanded class
      completedSection.querySelector('.completed-toggle-btn').addEventListener('click', () => {
        list.completedExpanded = !list.completedExpanded;
        saveState();
        renderBoard();
      });

      // Clear completed tasks button handler
      completedSection.querySelector('.completed-clear-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete all completed tasks in "${list.name}"? This action is permanent.`)) {
          clearCompletedTasksInList(list.id);
        }
      });

      // Insert completed section right before the add-task button
      columnEl.insertBefore(completedSection, columnEl.querySelector('.btn-add-task'));
    }

    // Event listner for list renaming
    const titleEl = columnEl.querySelector('.column-title');
    titleEl.addEventListener('blur', (e) => {
      const newName = e.target.textContent.trim();
      if (newName && newName !== list.name) {
        list.name = newName;
        saveState();
        updateStats();
      } else {
        e.target.textContent = list.name;
      }
    });
    titleEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleEl.blur();
      }
    });

    // Toggle active tasks collapse
    columnEl.querySelector('.column-toggle-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      list.incompleteExpanded = (list.incompleteExpanded === false);
      saveState();
      renderBoard();
    });

    // Delete list action
    columnEl.querySelector('.btn-delete-column').addEventListener('click', () => {
      if (confirm(`Are you sure you want to delete list "${list.name}"? All tasks inside will be lost.`)) {
        deleteColumn(list.id);
      }
    });

    // Add task click
    columnEl.querySelector('.btn-add-task').addEventListener('click', () => {
      addNewTaskInline(list.id);
    });

    // Column Drag handle bindings to initiate HTML5 dragging
    const dragHandle = columnEl.querySelector('.column-drag-handle');
    dragHandle.addEventListener('mousedown', () => {
      columnEl.setAttribute('draggable', 'true');
    });
    dragHandle.addEventListener('mouseup', () => {
      columnEl.setAttribute('draggable', 'false');
    });
    dragHandle.addEventListener('touchstart', () => {
      columnEl.setAttribute('draggable', 'true');
    });
    dragHandle.addEventListener('touchend', () => {
      columnEl.setAttribute('draggable', 'false');
    });

    columnEl.addEventListener('dragstart', (e) => {
      draggedColumnId = list.id;
      columnEl.classList.add('dragging-column');
      e.dataTransfer.setData('text/plain', list.id);
      e.dataTransfer.effectAllowed = 'move';
    });

    columnEl.addEventListener('dragend', () => {
      columnEl.classList.remove('dragging-column');
      draggedColumnId = null;
      columnEl.setAttribute('draggable', 'false');
      renderBoard();
    });

    canvas.appendChild(columnEl);

    // Setup drag and drop events for list container
    setupContainerDragEvents(tasksContainer);
  });

  // Render a placeholder "Create New List" card at the end
  const placeholderEl = document.createElement('div');
  placeholderEl.className = 'column-placeholder';
  placeholderEl.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
    <span>Create New List</span>
  `;
  placeholderEl.addEventListener('click', () => {
    addNewColumn();
  });
  canvas.appendChild(placeholderEl);

  // Update Focus Overlay dialog states in sync with board updates
  updateFocusOverlay();
}

// Create Card Elements
function createTaskCardElement(task, listId) {
  const card = document.createElement('div');
  card.className = `task-card${task.completed ? ' completed' : ''}`;
  card.id = task.id;
  card.draggable = !task.completed;
  card.dataset.listId = listId;

  // Checklist Circular Checkbox
  const checkboxBtn = document.createElement('button');
  checkboxBtn.className = 'task-checkbox-btn';
  checkboxBtn.setAttribute('aria-label', task.completed ? 'Mark uncompleted' : 'Mark completed');
  checkboxBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
  `;

  checkboxBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    task.completed = !task.completed;
    card.classList.toggle('completed', task.completed);
    checkboxBtn.setAttribute('aria-label', task.completed ? 'Mark uncompleted' : 'Mark completed');
    saveState();
    updateStats();
  });

  // Main row containing checkbox, title, note, options
  const mainRow = document.createElement('div');
  mainRow.className = 'task-card-main-row';
  mainRow.appendChild(checkboxBtn);

  const contentArea = document.createElement('div');
  contentArea.className = 'task-content-area';

  const titleText = document.createElement('span');
  titleText.className = 'task-title';
  titleText.contentEditable = true;
  titleText.title = "Double click card to edit details";
  titleText.textContent = task.title;

  const note = document.createElement('div');
  note.className = 'task-card-note';
  note.contentEditable = true;
  note.textContent = task.note || 'Add details...';
  if (!task.note) {
    note.style.fontStyle = 'italic';
    note.style.opacity = '0.4';
  }

  contentArea.appendChild(titleText);
  contentArea.appendChild(note);
  mainRow.appendChild(contentArea);

  // Options Menu Button (Ellipsis icon)
  const optionsBtn = document.createElement('button');
  optionsBtn.className = 'btn-icon-sm task-options-btn';
  optionsBtn.title = 'Options';
  optionsBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
  `;
  mainRow.appendChild(optionsBtn);

  // Meta Grid containing date-time & timer badges
  const metaGrid = document.createElement('div');
  metaGrid.className = 'task-meta-grid';

  // Render Due Date Badges
  if (task.dueDate) {
    const d = new Date(task.dueDate);
    const dateStr = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    const timeStr = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    const now = Date.now();
    const timeDiff = d.getTime() - now;
    
    let dueClass = 'badge-due-future';
    let statusText = `${dateStr}, ${timeStr}`;
    
    if (timeDiff < 0) {
      dueClass = 'badge-due-overdue';
      statusText = `Overdue: ${dateStr}`;
    } else if (timeDiff < 24 * 60 * 60 * 1000) {
      dueClass = 'badge-due-warning';
      statusText = `Soon: ${timeStr}`;
    }

    const dateBadge = document.createElement('span');
    dateBadge.className = `badge ${dueClass}`;
    dateBadge.title = `Due Date: ${d.toLocaleString()}`;
    dateBadge.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
      </svg>
      <span>${statusText}</span>
    `;
    
    dateBadge.addEventListener('click', (e) => {
      e.stopPropagation();
      openTaskModal(task.id);
    });
    
    metaGrid.appendChild(dateBadge);
  }

  // Render Timer Badge
  const timerContainer = document.createElement('div');
  timerContainer.className = 'timer-wrapper';
  renderTimerComponent(timerContainer, task);
  metaGrid.appendChild(timerContainer);

  card.appendChild(mainRow);
  card.appendChild(metaGrid);

  // Title edit inline blur
  titleText.addEventListener('blur', () => {
    const val = titleText.textContent.trim();
    if (val && val !== task.title) {
      task.title = val;
      saveState();
    } else {
      titleText.textContent = task.title;
    }
  });
  titleText.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      titleText.blur();
    }
  });

  // Note edit inline focus & blur
  note.addEventListener('focus', () => {
    if (note.textContent === 'Add details...') {
      note.textContent = '';
      note.style.fontStyle = 'normal';
      note.style.opacity = '1';
    }
  });
  note.addEventListener('blur', () => {
    const val = note.textContent.trim();
    if (val && val !== 'Add details...') {
      task.note = val;
    } else {
      task.note = '';
      note.textContent = 'Add details...';
      note.style.fontStyle = 'italic';
      note.style.opacity = '0.4';
    }
    saveState();
  });

  // Options Menu popover click
  optionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openTaskMenuPopover(task.id, listId, optionsBtn);
  });

  // Modal Dialog click
  card.addEventListener('dblclick', (e) => {
    // Open edit popup on double click, ignoring checkbox/options buttons, timer control buttons, and inline input elements
    if (!e.target.closest('.task-checkbox-btn') && 
        !e.target.closest('.task-options-btn') && 
        !e.target.closest('.timer-btn') && 
        !e.target.closest('.timer-setup-inline') &&
        e.target.tagName !== 'INPUT' && 
        e.target.tagName !== 'BUTTON') {
      openTaskModal(task.id);
    }
  });

  // Drag listeners
  card.addEventListener('dragstart', (e) => {
    draggedTaskId = task.id;
    draggedSourceListId = listId;
    draggedCardHeight = card.offsetHeight;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedTaskId = null;
    draggedSourceListId = null;
    draggedCardHeight = 0;
    document.querySelectorAll('.card-placeholder').forEach(p => p.remove());
    document.querySelectorAll('.board-column').forEach(c => c.classList.remove('drag-over'));
    renderBoard();
  });

  return card;
}

// Render dynamic Timer badges / inputs inside Card
function renderTimerComponent(wrapper, task) {
  wrapper.innerHTML = '';

  const timer = task.timer || { duration: 0, remaining: 0, state: 'idle', endTimeStamp: 0 };
  task.timer = timer; // safeguard

  if (timer.duration === 0) {
    // Option to set timer is optional
    const addTimerBtn = document.createElement('span');
    addTimerBtn.className = 'badge add-timer-badge';
    addTimerBtn.style.cursor = 'pointer';
    addTimerBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      <span>+ Timer</span>
    `;

    addTimerBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      renderTimerInlineInput(wrapper, task);
    });

    wrapper.appendChild(addTimerBtn);
  } else {
    // Show counting badge
    const badge = document.createElement('span');
    badge.className = `task-timer-badge state-${timer.state}`;
    
    const formatted = formatTime(timer.remaining);
    
    // Play/Pause icon depending on state
    let actionIcon = '';
    if (timer.state === 'running') {
      actionIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
    } else {
      actionIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
    }

    badge.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="timer-clock-icon"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
      <span class="timer-text">${formatted}</span>
      <button class="timer-btn timer-toggle-btn" title="${timer.state === 'running' ? 'Pause' : 'Play'}">${actionIcon}</button>
      <button class="timer-btn timer-reset-btn" title="Delete/Reset Timer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
      </button>
    `;

    // Click handler to toggle timer run/pause
    badge.querySelector('.timer-toggle-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      toggleTimer(task);
      renderTimerComponent(wrapper, task);
    });

    // Reset / Delete timer details
    badge.querySelector('.timer-reset-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteTimer(task);
      renderTimerComponent(wrapper, task);
    });

    // Click on timer text to edit duration inline
    const timeTextSpan = badge.querySelector('.timer-text');
    if (timeTextSpan) {
      timeTextSpan.style.cursor = 'pointer';
      timeTextSpan.title = 'Click to edit duration';
      timeTextSpan.addEventListener('click', (e) => {
        e.stopPropagation();
        renderTimerInlineInput(wrapper, task);
      });
    }

    wrapper.appendChild(badge);
  }
}

// Toggle inline input mode to define timer duration directly in card
function renderTimerInlineInput(wrapper, task) {
  wrapper.innerHTML = '';
  
  const setupEl = document.createElement('div');
  setupEl.className = 'timer-setup-inline';

  const existingMins = (task.timer && task.timer.duration > 0) ? Math.floor(task.timer.duration / 60) : 25;
  const existingSecs = (task.timer && task.timer.duration > 0) ? (task.timer.duration % 60) : 0;

  setupEl.innerHTML = `
    <input type="number" class="inline-time-in min" min="0" max="999" placeholder="MM" value="${existingMins}">
    <span class="colon-divider">:</span>
    <input type="number" class="inline-time-in sec" min="0" max="59" placeholder="SS" value="${String(existingSecs).padStart(2, '0')}">
    <button class="inline-save-btn">Set</button>
    <button class="inline-cancel-btn">×</button>
  `;

  // Focus on minute input
  setTimeout(() => setupEl.querySelector('.min').focus(), 50);

  const saveBtn = setupEl.querySelector('.inline-save-btn');
  const cancelBtn = setupEl.querySelector('.inline-cancel-btn');

  const onSave = () => {
    const mins = parseInt(setupEl.querySelector('.min').value) || 0;
    const secs = parseInt(setupEl.querySelector('.sec').value) || 0;
    const totalSecs = (mins * 60) + secs;

    if (totalSecs > 0) {
      task.timer = {
        duration: totalSecs,
        remaining: totalSecs,
        state: 'paused',
        endTimeStamp: 0
      };
      state.lists.forEach(list => {
        if (list.tasks.some(t => t.id === task.id)) {
          list.activeTimerTaskId = task.id;
        }
      });
      saveState();
    }
    renderBoard();
  };

  saveBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    onSave();
  });

  cancelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    renderTimerComponent(wrapper, task);
  });

  setupEl.querySelectorAll('input').forEach(input => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        onSave();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renderTimerComponent(wrapper, task);
      }
    });
    // Stop event bubbling for dragging
    input.addEventListener('mousedown', (e) => e.stopPropagation());
  });

  wrapper.appendChild(setupEl);
}

// Timer Logic Handlers
function toggleTimer(task) {
  const timer = task.timer;
  if (!timer) return;

  state.lists.forEach(list => {
    if (list.tasks.some(t => t.id === task.id)) {
      list.activeTimerTaskId = task.id;
    }
  });

  if (timer.state === 'running') {
    // Pause
    const now = Date.now();
    const end = timer.endTimeStamp || now;
    timer.remaining = Math.max(0, Math.ceil((end - now) / 1000));
    timer.state = 'paused';
    timer.endTimeStamp = 0;
  } else {
    // Play / Resume
    state.activeFocusTaskId = task.id;
    
    // Ensure only 1 active timer runs globally in the entire application
    state.lists.forEach(list => {
      list.tasks.forEach(t => {
        if (t.id !== task.id && t.timer && t.timer.state === 'running') {
          // Pause other running task
          const now = Date.now();
          const end = t.timer.endTimeStamp || now;
          t.timer.remaining = Math.max(0, Math.ceil((end - now) / 1000));
          t.timer.state = 'paused';
          t.timer.endTimeStamp = 0;
        }
      });
    });

    if (timer.state === 'completed' || timer.remaining <= 0) {
      timer.remaining = timer.duration;
    }
    timer.state = 'running';
    timer.endTimeStamp = Date.now() + (timer.remaining * 1000);
  }
  saveState();
  updateStats();
}

function deleteTimer(task) {
  task.timer = {
    duration: 0,
    remaining: 0,
    state: 'idle',
    endTimeStamp: 0
  };
  state.lists.forEach(list => {
    if (list.activeTimerTaskId === task.id) {
      list.activeTimerTaskId = null;
    }
  });
  if (state.activeFocusTaskId === task.id) {
    state.activeFocusTaskId = null;
  }
  saveState();
  updateStats();
}

// Format Seconds into MM:SS
function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Helper to display a custom notification modal
function showAlertModal(title, message, taskContext = null) {
  const alertModal = document.getElementById('alert-modal');
  if (!alertModal) return;

  document.getElementById('alert-title').textContent = title;
  document.getElementById('alert-message').textContent = message;

  // Add standout styling if it's timer completion or due date expiration
  if (title.includes("Timer Completed") || title.includes("Task Deadline Reached")) {
    alertModal.classList.add('alert-timer-completed');
  } else {
    alertModal.classList.remove('alert-timer-completed');
  }

  // Render Up Next task section inside Alert Modal if context is provided
  const nextTaskContainer = document.getElementById('alert-next-task-container');
  if (nextTaskContainer) {
    let nextTask = null;
    if (taskContext) {
      let activeList = null;
      state.lists.forEach(list => {
        if (list.tasks.some(tk => tk.id === taskContext.id)) {
          activeList = list;
        }
      });

      if (activeList) {
        const incompleteTasks = activeList.tasks.filter(t => !t.completed);
        const currentIdx = incompleteTasks.findIndex(t => t.id === taskContext.id);
        if (currentIdx !== -1 && currentIdx + 1 < incompleteTasks.length) {
          nextTask = incompleteTasks[currentIdx + 1];
        }
      }
    }

    if (nextTask) {
      nextTaskContainer.style.display = 'flex';
      const nextTitleEl = document.getElementById('alert-next-task-title');
      if (nextTitleEl) {
        nextTitleEl.textContent = nextTask.title;
      }

      const timerWrapper = document.getElementById('alert-next-task-timer-wrapper');
      const timerBtn = document.getElementById('alert-next-task-timer-btn');
      const editBtn = document.getElementById('alert-next-task-edit-btn');
      const setupDiv = document.getElementById('alert-next-task-timer-setup');
      
      if (timerWrapper && timerBtn && editBtn && setupDiv) {
        const minInput = setupDiv.querySelector('.alert-next-min');
        const secInput = setupDiv.querySelector('.alert-next-sec');
        const setBtn = setupDiv.querySelector('.alert-next-set-btn');

        const bindSetAction = () => {
          if (setBtn && minInput && secInput) {
            const newSetBtn = setBtn.cloneNode(true);
            setBtn.parentNode.replaceChild(newSetBtn, setBtn);
            
            const handleSet = (e) => {
              e.stopPropagation();
              const mins = parseInt(minInput.value) || 0;
              const secs = parseInt(secInput.value) || 0;
              const totalSecs = (mins * 60) + secs;
              
              if (totalSecs > 0) {
                nextTask.timer = {
                  duration: totalSecs,
                  remaining: totalSecs,
                  state: 'paused',
                  endTimeStamp: 0
                };
                
                state.lists.forEach(list => {
                  if (list.tasks.some(t => t.id === nextTask.id)) {
                    list.activeTimerTaskId = nextTask.id;
                  }
                });
                
                saveState();
                
                // Refresh modal view immediately to show Play button
                showAlertModal(title, message, taskContext);
              }
            };
            
            newSetBtn.addEventListener('click', handleSet);
            minInput.onkeydown = (e) => { if (e.key === 'Enter') handleSet(e); };
            secInput.onkeydown = (e) => { if (e.key === 'Enter') handleSet(e); };
          }
        };

        if (nextTask.timer && nextTask.timer.duration > 0) {
          timerWrapper.style.display = 'flex';
          setupDiv.style.display = 'none';
          
          const timeSpan = document.getElementById('alert-next-task-timer-time');
          if (timeSpan) {
            timeSpan.textContent = formatTime(nextTask.timer.remaining);
          }
          
          // Bind Play Button
          const newTimerBtn = timerBtn.cloneNode(true);
          timerBtn.parentNode.replaceChild(newTimerBtn, timerBtn);
          newTimerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            alertModal.close(); // Dismisses modal & stops repeating chime!
            toggleTimer(nextTask);
            renderBoard();
          });

          // Bind Edit Button
          const newEditBtn = editBtn.cloneNode(true);
          editBtn.parentNode.replaceChild(newEditBtn, editBtn);
          newEditBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            timerWrapper.style.display = 'none';
            setupDiv.style.display = 'flex';
            if (minInput && secInput) {
              minInput.value = Math.floor(nextTask.timer.duration / 60);
              secInput.value = nextTask.timer.duration % 60;
              setTimeout(() => minInput.focus(), 50);
            }
            bindSetAction();
          });
        } else {
          timerWrapper.style.display = 'none';
          setupDiv.style.display = 'flex';
          if (minInput && secInput) {
            minInput.value = '25';
            secInput.value = '00';
          }
          bindSetAction();
        }
      }
    } else {
      nextTaskContainer.style.display = 'none';
    }
  }

  alertModal.showModal();
}

// Update current date and time on all display elements
function updateDateTimeDisplays() {
  const now = new Date();
  
  // Format Time: e.g. 10:47 AM
  const timeStr = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  // Format Date: e.g. Tuesday, June 9, 2026
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const fullStr = `${dateStr} • ${timeStr}`;

  // Update Header Date and Time
  const headerTime = document.getElementById('header-time');
  const headerDate = document.getElementById('header-date');
  if (headerTime) headerTime.textContent = timeStr;
  if (headerDate) headerDate.textContent = dateStr;

  // Update all Modal DateTime Displays
  document.querySelectorAll('.modal-datetime-display').forEach(el => {
    el.textContent = fullStr;
  });

  // Update Focus Overlay DateTime Display
  const focusDateTime = document.getElementById('focus-datetime-display');
  if (focusDateTime) {
    focusDateTime.textContent = fullStr;
  }
}

// Start visual ticker updates for all cards
function startGlobalTicker() {
  if (tickerInterval) clearInterval(tickerInterval);

  // Initial immediate run to populate date/time right away
  updateDateTimeDisplays();

  tickerInterval = setInterval(() => {
    updateDateTimeDisplays();
    let hasRunningTimers = false;
    let stateChanged = false;
    let needsBoardRender = false;

    state.lists.forEach(list => {
      list.tasks.forEach(task => {
        // 1. Check Due Dates
        if (task.dueDate && !task.dueDateAlerted) {
          const dueTime = new Date(task.dueDate).getTime();
          if (Date.now() >= dueTime) {
            task.dueDateAlerted = true;
            stateChanged = true;
            needsBoardRender = true;
            playTimerCompletionSound();
            showAlertModal("Task Deadline Reached ⏰", `The task "${task.title}" is due now!`, task);
          }
        }

        // 2. Check Running Timers
        if (task.timer && task.timer.state === 'running') {
          hasRunningTimers = true;
          const now = Date.now();
          const target = task.timer.endTimeStamp || 0;
          
          const delta = Math.max(0, Math.ceil((target - now) / 1000));
          task.timer.remaining = delta;

          // Find timer UI elements in page to update dynamically
          const cardEl = document.getElementById(task.id);
          if (cardEl) {
            const timerWrapper = cardEl.querySelector('.timer-wrapper');
            if (timerWrapper) {
              const timerText = timerWrapper.querySelector('.timer-text');
              if (timerText) {
                timerText.textContent = formatTime(delta);
              }
            }
          }


          if (delta <= 0) {
            task.timer.state = 'completed';
            task.timer.remaining = 0;
            task.timer.endTimeStamp = 0;
            stateChanged = true;
            needsBoardRender = true;
            playTimerCompletionSound();
            startRepeatingChime();
            showAlertModal("Timer Completed ⏱️", `The timer for task "${task.title}" has finished!`, task);
          }
        }
      });
    });

    if (stateChanged) {
      saveState();
    }
    if (needsBoardRender) {
      renderBoard();
    } else {
      updateFocusOverlay();
    }
  }, 1000);
}

// Add empty inline task
function addNewTaskInline(listId) {
  const list = state.lists.find(l => l.id === listId);
  if (!list) return;

  // Auto-expand list when adding task
  list.incompleteExpanded = true;

  const newTask = {
    id: 'task-' + generateId(),
    title: 'New Task',
    note: '',
    dueDate: '',
    timer: { duration: 0, remaining: 0, state: 'idle', endTimeStamp: 0 }
  };

  list.tasks.push(newTask);
  saveState();
  renderBoard();

  // Highlight and focus the newly created task card title immediately
  setTimeout(() => {
    const card = document.getElementById(newTask.id);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      const title = card.querySelector('.task-title');
      if (title) {
        title.focus();
        // Select all text in it
        const range = document.createRange();
        range.selectNodeContents(title);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
  }, 100);
}

// Delete Task
function deleteTask(taskId) {
  state.lists.forEach(list => {
    list.tasks = list.tasks.filter(t => t.id !== taskId);
    if (list.activeTimerTaskId === taskId) {
      list.activeTimerTaskId = null;
    }
  });
  if (state.activeFocusTaskId === taskId) {
    state.activeFocusTaskId = null;
  }
  saveState();
  renderBoard();
}

// Delete Column
function deleteColumn(listId) {
  state.lists = state.lists.filter(l => l.id !== listId);
  saveState();
  renderBoard();
}

// Clear all completed tasks in a specific list
function clearCompletedTasksInList(listId) {
  const list = state.lists.find(l => l.id === listId);
  if (!list) return;

  const activeTask = list.tasks.find(t => t.id === list.activeTimerTaskId);
  if (activeTask && activeTask.completed) {
    list.activeTimerTaskId = null;
  }

  const completedFocusTask = list.tasks.find(t => t.id === state.activeFocusTaskId && t.completed);
  if (completedFocusTask) {
    state.activeFocusTaskId = null;
  }

  list.tasks = list.tasks.filter(task => !task.completed);
  saveState();
  renderBoard();
}

// Open Task Modal Detail Dialog
function openTaskModal(taskId) {
  const taskModal = document.getElementById('task-modal');
  let foundTask = null;
  let listId = null;

  state.lists.forEach(list => {
    const t = list.tasks.find(tk => tk.id === taskId);
    if (t) {
      foundTask = t;
      listId = list.id;
    }
  });

  if (!foundTask) return;

  document.getElementById('modal-task-id').value = foundTask.id;
  document.getElementById('modal-list-id').value = listId;
  document.getElementById('modal-task-title').value = foundTask.title;
  document.getElementById('modal-task-note').value = foundTask.note || '';
  document.getElementById('modal-task-due').value = foundTask.dueDate || '';

  // Timer parsing values
  const timer = foundTask.timer || { duration: 0 };
  const mins = Math.floor((timer.duration || 0) / 60);
  const secs = (timer.duration || 0) % 60;

  document.getElementById('modal-timer-min').value = mins > 0 ? mins : '';
  document.getElementById('modal-timer-sec').value = secs > 0 ? secs : '';

  taskModal.showModal();
}

// Save Modal details back to state
function saveModalTask() {
  const taskId = document.getElementById('modal-task-id').value;
  const listId = document.getElementById('modal-list-id').value;
  const title = document.getElementById('modal-task-title').value;
  const note = document.getElementById('modal-task-note').value;
  const due = document.getElementById('modal-task-due').value;

  const minVal = parseInt(document.getElementById('modal-timer-min').value) || 0;
  const secVal = parseInt(document.getElementById('modal-timer-sec').value) || 0;
  const totalSecs = (minVal * 60) + secVal;

  const list = state.lists.find(l => l.id === listId);
  if (!list) return;

  const task = list.tasks.find(t => t.id === taskId);
  if (!task) return;

  task.title = title.trim() || 'Untitled Task';
  task.note = note.trim();
  
  if (task.dueDate !== due) {
    task.dueDate = due;
    task.dueDateAlerted = false; // Reset alerted flag when the deadline changes
  }

  // Check if timer duration is changed
  if (task.timer.duration !== totalSecs) {
    if (totalSecs > 0) {
      task.timer = {
        duration: totalSecs,
        remaining: totalSecs,
        state: 'paused',
        endTimeStamp: 0
      };
      list.activeTimerTaskId = task.id;
    } else {
      task.timer = {
        duration: 0,
        remaining: 0,
        state: 'idle',
        endTimeStamp: 0
      };
      if (list.activeTimerTaskId === task.id) {
        list.activeTimerTaskId = null;
      }
      if (state.activeFocusTaskId === task.id) {
        state.activeFocusTaskId = null;
      }
    }
  }

  saveState();
  renderBoard();
}

// Open accessibility popup actions menu on click
function openTaskMenuPopover(taskId, listId, anchorEl) {
  const popover = document.getElementById('task-menu-popover');
  popover.dataset.activeTaskId = taskId;
  popover.dataset.activeListId = listId;

  // Build the list destinations dynamically for moving tasks
  const destinationsContainer = document.getElementById('menu-move-destinations');
  destinationsContainer.innerHTML = '';

  const otherLists = state.lists.filter(l => l.id !== listId);
  if (otherLists.length === 0) {
    destinationsContainer.innerHTML = '<span style="color: var(--text-dark); font-size: 0.75rem; padding: 0.5rem 0.75rem; display:block;">No other lists</span>';
  } else {
    otherLists.forEach(destList => {
      const button = document.createElement('button');
      button.className = 'menu-action';
      button.innerHTML = `
        <svg class="menu-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
        <span>To: ${escapeHtml(destList.name)}</span>
      `;
      button.addEventListener('click', () => {
        moveTask(taskId, listId, destList.id);
        popover.hidePopover();
      });
      destinationsContainer.appendChild(button);
    });
  }

  // Position popover relative to button (Anchor positioning fallback)
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = `${rect.bottom + window.scrollY + 6}px`;
  popover.style.left = `${Math.min(window.innerWidth - 210, rect.left + window.scrollX)}px`;

  popover.showPopover();
}

// Move task helper
function moveTask(taskId, sourceListId, targetListId, targetIndex = null) {
  const sourceList = state.lists.find(l => l.id === sourceListId);
  const targetList = state.lists.find(l => l.id === targetListId);
  if (!sourceList || !targetList) return;

  const taskIndex = sourceList.tasks.findIndex(t => t.id === taskId);
  if (taskIndex === -1) return;

  const [task] = sourceList.tasks.splice(taskIndex, 1);

  if (sourceList.activeTimerTaskId === taskId) {
    sourceList.activeTimerTaskId = null;
  }

  if (task.timer && task.timer.duration > 0) {
    targetList.activeTimerTaskId = task.id;
    if (task.timer.state === 'running') {
      // Pause any other running task in targetList
      targetList.tasks.forEach(t => {
        if (t.timer && t.timer.state === 'running') {
          const now = Date.now();
          const end = t.timer.endTimeStamp || now;
          t.timer.remaining = Math.max(0, Math.ceil((end - now) / 1000));
          t.timer.state = 'paused';
          t.timer.endTimeStamp = 0;
        }
      });
    }
  }

  if (targetIndex !== null) {
    targetList.tasks.splice(targetIndex, 0, task);
  } else {
    targetList.tasks.push(task);
  }

  saveState();
  renderBoard();
}

// Setup Drag & Drop Event Listners for columns
function setupContainerDragEvents(container) {
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    const afterElement = getDragAfterElement(container, e.clientY);
    
    // Add visual cues to highlight column
    const column = container.closest('.board-column');
    column.classList.add('drag-over');

    // Clean up placeholders in other columns
    document.querySelectorAll('.card-placeholder').forEach(p => {
      if (p.parentNode !== container) {
        p.remove();
      }
    });

    // Create or position placeholder
    let placeholder = container.querySelector('.card-placeholder');
    if (!placeholder) {
      placeholder = document.createElement('div');
      placeholder.className = 'card-placeholder';
      placeholder.style.height = `${draggedCardHeight || 80}px`;
    }

    if (afterElement == null) {
      container.appendChild(placeholder);
    } else {
      container.insertBefore(placeholder, afterElement);
    }
  });

  container.addEventListener('dragleave', () => {
    const column = container.closest('.board-column');
    column.classList.remove('drag-over');
  });

  container.addEventListener('drop', (e) => {
    e.preventDefault();
    const column = container.closest('.board-column');
    column.classList.remove('drag-over');

    const targetListId = container.dataset.listId;
    if (!draggedTaskId || !draggedSourceListId) return;

    // Find the placeholder's position in the target container
    const placeholder = container.querySelector('.card-placeholder');
    let targetIndex = null;
    if (placeholder) {
      const cardsAndPlaceholder = [...container.children].filter(child => !child.classList.contains('dragging'));
      targetIndex = cardsAndPlaceholder.indexOf(placeholder);
      placeholder.remove();
    } else {
      // Fallback
      const cards = [...container.querySelectorAll('.task-card:not(.dragging)')];
      const afterElement = getDragAfterElement(container, e.clientY);
      if (afterElement) {
        targetIndex = cards.indexOf(afterElement);
      } else {
        targetIndex = cards.length;
      }
    }

    // Perform mutation
    moveTask(draggedTaskId, draggedSourceListId, targetListId, targetIndex);
  });
}

// Find node after element depending on dragging Y coordinate
function getDragAfterElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task-card:not(.dragging)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Calculate board stats for header dashboard
function updateStats() {
  // Stat counters removed from header
}

// Helper: Escape user HTML input
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Find horizontal element positioning for columns
function getDragAfterColumnElement(container, x) {
  const draggableElements = [...container.querySelectorAll('.board-column:not(.dragging-column)')];
  
  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = x - box.left - box.width / 2;
    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Export current state/session to JSON file
function exportSession() {
  try {
    const dataStr = JSON.stringify(state, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const dateStr = new Date().toISOString().slice(0, 10);
    const fileName = `taskorbit_session_${dateStr}.json`;
    
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Export failed:", error);
    showAlertModal("Export Failed ❌", "An error occurred while exporting the session.");
  }
}

// Import state/session from JSON file
function importSession(file) {
  const reader = new FileReader();
  reader.onload = function(event) {
    try {
      const importedData = JSON.parse(event.target.result);
      
      // Simple validation: must have lists array
      if (!importedData || !Array.isArray(importedData.lists)) {
        throw new Error("Invalid session structure");
      }
      
      // Sanitization: ensure each list and task has basic fields
      importedData.lists.forEach(list => {
        if (!list.id || !list.name || !Array.isArray(list.tasks)) {
          throw new Error("Invalid list structure in session file");
        }
        list.tasks.forEach(task => {
          if (!task.id || !task.title) {
            throw new Error("Invalid task structure in session file");
          }
          if (!task.timer) {
            task.timer = { duration: 0, remaining: 0, state: 'idle', endTimeStamp: 0 };
          }
        });
      });

      // Update state
      state = importedData;
      
      // Handle elapsed time for active/running timers
      state.lists.forEach(list => {
        list.tasks.forEach(task => {
          if (task.timer && task.timer.state === 'running') {
            const now = Date.now();
            const end = task.timer.endTimeStamp || 0;
            if (end > now) {
              task.timer.remaining = Math.max(0, Math.ceil((end - now) / 1000));
            } else {
              task.timer.remaining = 0;
              task.timer.state = 'completed';
            }
          }
          if (task.dueDate) {
            const dueTime = new Date(task.dueDate).getTime();
            if (Date.now() >= dueTime) {
              task.dueDateAlerted = true;
            } else {
              task.dueDateAlerted = false;
            }
          }
        });
      });

      saveState();
      renderBoard();
      updateStats();
      showAlertModal("Session Imported Successfully 📂", "Your board session has been restored from the file.");
    } catch (e) {
      console.error("Import failed:", e);
      showAlertModal("Import Failed ❌", "The selected file is not a valid TaskOrbit session file.");
    }
  };
  reader.readAsText(file);
}

// Update the Focus Overlay dialog UI state
function updateFocusOverlay() {
  const overlay = document.getElementById('focus-overlay');
  if (!overlay) return;

  if (!state.activeFocusTaskId) {
    overlay.classList.add('hidden');
    return;
  }

  // Find the active focus task
  let focusTask = null;
  state.lists.forEach(list => {
    const t = list.tasks.find(tk => tk.id === state.activeFocusTaskId);
    if (t) focusTask = t;
  });

  if (!focusTask || !focusTask.timer || focusTask.timer.duration === 0 || focusTask.timer.state === 'idle') {
    state.activeFocusTaskId = null;
    overlay.classList.add('hidden');
    saveState();
    return;
  }

  // Update text & time
  document.getElementById('focus-task-name').textContent = focusTask.title;
  document.getElementById('focus-time').textContent = formatTime(focusTask.timer.remaining);

  // Set classes
  overlay.className = `focus-overlay state-${focusTask.timer.state}`;
  if (state.focusOverlayMinimized) {
    overlay.classList.add('minimized');
  }

  // Set toggle button icon
  const toggleBtn = document.getElementById('focus-btn-toggle');
  if (toggleBtn) {
    if (focusTask.timer.state === 'running') {
      toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
      toggleBtn.title = "Pause Timer";
    } else {
      toggleBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>`;
      toggleBtn.title = "Play Timer";
    }
  }

  // Find next task in the same column
  const nextTaskContainer = document.getElementById('focus-next-task-container');
  if (nextTaskContainer) {
    let activeList = null;
    state.lists.forEach(list => {
      if (list.tasks.some(tk => tk.id === state.activeFocusTaskId)) {
        activeList = list;
      }
    });

    let nextTask = null;
    if (activeList) {
      const incompleteTasks = activeList.tasks.filter(t => !t.completed);
      const currentIdx = incompleteTasks.findIndex(t => t.id === state.activeFocusTaskId);
      if (currentIdx !== -1 && currentIdx + 1 < incompleteTasks.length) {
        nextTask = incompleteTasks[currentIdx + 1];
      }
    }

    if (nextTask) {
      nextTaskContainer.style.display = 'flex';
      const nextTitleEl = document.getElementById('focus-next-task-title');
      if (nextTitleEl) {
        nextTitleEl.textContent = nextTask.title;
      }

      const timerWrapper = document.getElementById('focus-next-task-timer-wrapper');
      const timerBtn = document.getElementById('focus-next-task-timer-btn');
      const editBtn = document.getElementById('focus-next-task-edit-btn');
      const setupDiv = document.getElementById('focus-next-task-timer-setup');
      
      if (timerWrapper && timerBtn && editBtn && setupDiv) {
        const minInput = setupDiv.querySelector('.focus-next-min');
        const secInput = setupDiv.querySelector('.focus-next-sec');
        const setBtn = setupDiv.querySelector('.focus-next-set-btn');

        const bindSetAction = () => {
          if (setBtn && minInput && secInput) {
            const newSetBtn = setBtn.cloneNode(true);
            setBtn.parentNode.replaceChild(newSetBtn, setBtn);
            
            const handleSet = (e) => {
              e.stopPropagation();
              const mins = parseInt(minInput.value) || 0;
              const secs = parseInt(secInput.value) || 0;
              const totalSecs = (mins * 60) + secs;
              if (totalSecs > 0) {
                nextTask.timer = {
                  duration: totalSecs,
                  remaining: totalSecs,
                  state: 'paused',
                  endTimeStamp: 0
                };
                state.lists.forEach(list => {
                  if (list.tasks.some(t => t.id === nextTask.id)) {
                    list.activeTimerTaskId = nextTask.id;
                  }
                });
                saveState();
                renderBoard();
              }
            };
            newSetBtn.addEventListener('click', handleSet);
            minInput.onkeydown = (e) => { if (e.key === 'Enter') handleSet(e); };
            secInput.onkeydown = (e) => { if (e.key === 'Enter') handleSet(e); };
          }
        };

        if (nextTask.timer && nextTask.timer.duration > 0) {
          timerWrapper.style.display = 'flex';
          setupDiv.style.display = 'none';
          
          const timeSpan = document.getElementById('focus-next-task-timer-time');
          if (timeSpan) {
            timeSpan.textContent = formatTime(nextTask.timer.remaining);
          }
          
          // Bind Play Button
          const newTimerBtn = timerBtn.cloneNode(true);
          timerBtn.parentNode.replaceChild(newTimerBtn, timerBtn);
          newTimerBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleTimer(nextTask);
            renderBoard();
          });

          // Bind Edit Button
          const newEditBtn = editBtn.cloneNode(true);
          editBtn.parentNode.replaceChild(newEditBtn, editBtn);
          newEditBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            timerWrapper.style.display = 'none';
            setupDiv.style.display = 'flex';
            if (minInput && secInput) {
              minInput.value = Math.floor(nextTask.timer.duration / 60);
              secInput.value = nextTask.timer.duration % 60;
              setTimeout(() => minInput.focus(), 50);
            }
            bindSetAction();
          });
        } else {
          timerWrapper.style.display = 'none';
          setupDiv.style.display = 'flex';
          if (minInput && secInput) {
            minInput.value = '25';
            secInput.value = '00';
          }
          bindSetAction();
        }
      }
    } else {
      nextTaskContainer.style.display = 'none';
    }
  }
}

// Update UI toggle button and text based on state.soundEnabled
function updateSoundUI() {
  const soundIcon = document.getElementById('sound-icon');
  const soundText = document.getElementById('sound-status-text');
  const toggleSoundBtn = document.getElementById('toggle-sound-btn');
  if (!soundIcon || !soundText) return;

  if (state.soundEnabled) {
    soundIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
    `;
    soundText.textContent = "Sound On";
    if (toggleSoundBtn) {
      toggleSoundBtn.title = "Mute sound alerts";
    }
  } else {
    soundIcon.innerHTML = `
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
      <line x1="23" y1="9" x2="17" y2="15"></line>
      <line x1="17" y1="9" x2="23" y2="15"></line>
    `;
    soundText.textContent = "Muted";
    if (toggleSoundBtn) {
      toggleSoundBtn.title = "Unmute sound alerts";
    }
  }
}

// Play a clean, premium synthesizer chime when a timer completes
function playTimerCompletionSound() {
  if (!state.soundEnabled) return;
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    
    // Play a nice two-tone notification chime (E6 then A6)
    const playChimeNode = (freq, startTime, duration) => {
      const osc = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startTime);
      
      // Smooth decay envelope
      gainNode.gain.setValueAtTime(0, startTime);
      gainNode.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
      gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      
      osc.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = audioCtx.currentTime;
    playChimeNode(1318.51, now, 0.6); // E6
    playChimeNode(1760.00, now + 0.12, 0.8); // A6
  } catch (err) {
    console.warn("AudioContext failed to initialize or play completion sound:", err);
  }
}

// Start repeating completion chime
function startRepeatingChime() {
  if (!state.soundEnabled) return;
  if (chimeRepeatInterval) clearInterval(chimeRepeatInterval);
  // Repeat playTimerCompletionSound every 2.5 seconds
  chimeRepeatInterval = setInterval(() => {
    playTimerCompletionSound();
  }, 2500);
}

// Stop repeating completion chime
function stopRepeatingChime() {
  if (chimeRepeatInterval) {
    clearInterval(chimeRepeatInterval);
    chimeRepeatInterval = null;
  }
}

// ==========================================
// Autosave & Local Folder Sync Implementation
// ==========================================

const DB_NAME = 'TaskOrbitAutosaveDB';
const STORE_NAME = 'handles';
const KEY_NAME = 'directoryHandle';
let autosaveInterval = null;

// Open IndexedDB connection to store non-serializable FileSystemDirectoryHandle objects
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = (e) => resolve(e.target.result);
    request.onerror = (e) => reject(e.target.error);
  });
}

// Persist the directory handle to IndexedDB
async function saveFolderHandle(handle) {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.put(handle, KEY_NAME);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to save folder handle in IndexedDB:", err);
  }
}

// Retrieve the directory handle from IndexedDB
async function loadFolderHandle() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(KEY_NAME);
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error("Failed to load folder handle from IndexedDB:", err);
    return null;
  }
}

// Clear the directory handle from IndexedDB
async function clearFolderHandle() {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    store.delete(KEY_NAME);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.error("Failed to clear folder handle in IndexedDB:", err);
  }
}

// Initialize the autosave mechanisms
async function initAutosave() {
  if (!state.autosave) return;

  // 1. Populate UI fields based on current settings
  const handle = await loadFolderHandle();
  if (handle) {
    state.autosave.folderName = handle.name;
    const folderInfo = document.getElementById('autosave-folder-info');
    if (folderInfo) {
      folderInfo.textContent = `Folder: ${handle.name}`;
    }
  }

  // 2. Start the periodic interval timer
  startAutosaveTimer();

  // 3. Update status text and dot in header
  updateAutosaveUI();

  // 4. One-time interactive user-gesture verification for loaded handles
  if (state.autosave.fileEnabled && handle) {
    const requestPermissionOnFirstClick = async () => {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission !== 'granted') {
        try {
          await handle.requestPermission({ mode: 'readwrite' });
        } catch (e) {
          console.warn("Interactive autosave directory permission prompt was rejected or deferred.", e);
        }
      }
      updateAutosaveUI();
      document.removeEventListener('click', requestPermissionOnFirstClick);
    };
    document.addEventListener('click', requestPermissionOnFirstClick);
  }
}

// Start the 5 minute periodic timer
function startAutosaveTimer() {
  if (autosaveInterval) clearInterval(autosaveInterval);
  
  autosaveInterval = setInterval(() => {
    triggerAutosave();
  }, 5 * 60 * 1000); // 5 minutes
}

// Run the autosave action
async function triggerAutosave() {
  if (!state.autosave || !state.autosave.enabled) return;

  // Save to standard localStorage key as a secondary backup
  localStorage.setItem('taskorbit_board_state_autosave', JSON.stringify(state));
  console.log("Autosave: Saved current session state to LocalStorage backup.");

  // Save to local folder if enabled
  if (state.autosave.fileEnabled) {
    const handle = await loadFolderHandle();
    if (handle) {
      try {
        const permission = await handle.queryPermission({ mode: 'readwrite' });
        if (permission === 'granted') {
          const fileHandle = await handle.getFileHandle('taskorbit-session-autosave.json', { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(JSON.stringify(state, null, 2));
          await writable.close();
          console.log("Autosave: Wrote session file to local folder.");
          updateAutosaveUI();
        } else {
          console.warn("Autosave skipped: Write permission not granted.");
          updateAutosaveUI();
        }
      } catch (err) {
        console.error("Autosave file write failed:", err);
        updateAutosaveUI();
      }
    } else {
      console.warn("Autosave skipped: No local directory handle found.");
      updateAutosaveUI();
    }
  } else {
    updateAutosaveUI();
  }
}

// Update the header button text and status dot dynamically
async function updateAutosaveUI() {
  const statusText = document.getElementById('autosave-status-text');
  const statusDot = document.getElementById('autosave-status-dot');
  if (!statusText || !statusDot) return;

  if (!state.autosave || !state.autosave.enabled) {
    statusText.textContent = 'Autosave: Off';
    statusDot.className = 'autosave-status-dot';
    return;
  }

  if (state.autosave.fileEnabled) {
    const handle = await loadFolderHandle();
    if (handle) {
      const permission = await handle.queryPermission({ mode: 'readwrite' });
      if (permission === 'granted') {
        statusText.textContent = 'Autosave: Active';
        statusDot.className = 'autosave-status-dot success';
      } else {
        statusText.textContent = 'Autosave: Auth Needed';
        statusDot.className = 'autosave-status-dot warning';
      }
    } else {
      statusText.textContent = 'Autosave: Config Error';
      statusDot.className = 'autosave-status-dot error';
    }
  } else {
    statusText.textContent = 'Autosave: LocalStorage';
    statusDot.className = 'autosave-status-dot success';
  }
}

// Open Autosave Configuration Modal Dialog
function openAutosaveModal() {
  const modal = document.getElementById('autosave-modal');
  if (!modal) return;

  const enableCheckbox = document.getElementById('autosave-enable');
  const fileCheckbox = document.getElementById('autosave-file-enable');
  const folderSelection = document.getElementById('autosave-folder-selection');
  const folderInfo = document.getElementById('autosave-folder-info');

  if (enableCheckbox && fileCheckbox && folderSelection && folderInfo) {
    enableCheckbox.checked = !!state.autosave.enabled;
    fileCheckbox.checked = !!state.autosave.fileEnabled;
    folderSelection.style.display = state.autosave.fileEnabled ? 'flex' : 'none';
    folderInfo.textContent = state.autosave.folderName ? `Folder: ${state.autosave.folderName}` : 'No folder selected';

    // Toggle folder picker visibility based on checkbox status
    const toggleFolderDisplay = () => {
      folderSelection.style.display = fileCheckbox.checked ? 'flex' : 'none';
    };
    fileCheckbox.onchange = toggleFolderDisplay;

    // Check directory picker browser support
    const selectBtn = document.getElementById('autosave-select-folder-btn');
    if (selectBtn) {
      if (typeof window.showDirectoryPicker !== 'function') {
        selectBtn.disabled = true;
        selectBtn.title = "Directory Picker API is not supported in this browser. Try Chrome or Edge.";
        folderInfo.textContent = "Folder sync not supported in this browser.";
      } else {
        selectBtn.disabled = false;
      }
    }
  }

  modal.showModal();
}
