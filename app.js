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

// Ticker interval
let tickerInterval = null;

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  loadState();
  initEventListeners();
  startGlobalTicker();
  updateStats();
});

// Load State from LocalStorage
function loadState() {
  const localData = localStorage.getItem('taskorbit_board_state');
  if (localData) {
    try {
      state = JSON.parse(localData);
      
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
  // Add list column button
  const addListBtn = document.getElementById('add-list-btn');
  addListBtn.addEventListener('click', () => {
    addNewColumn();
  });

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
    if (e.target !== titleText && e.target !== note && !e.target.closest('.badge') && !e.target.closest('.timer-wrapper') && !e.target.closest('.task-checkbox-btn')) {
      openTaskModal(task.id);
    }
  });

  // Drag listeners
  card.addEventListener('dragstart', (e) => {
    draggedTaskId = task.id;
    draggedSourceListId = listId;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  });

  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    draggedTaskId = null;
    draggedSourceListId = null;
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

    wrapper.appendChild(badge);
  }
}

// Toggle inline input mode to define timer duration directly in card
function renderTimerInlineInput(wrapper, task) {
  wrapper.innerHTML = '';
  
  const setupEl = document.createElement('div');
  setupEl.className = 'timer-setup-inline';

  setupEl.innerHTML = `
    <input type="number" class="inline-time-in min" min="0" max="999" placeholder="MM" value="25">
    <span class="colon-divider">:</span>
    <input type="number" class="inline-time-in sec" min="0" max="59" placeholder="SS" value="00">
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
function showAlertModal(title, message) {
  const alertModal = document.getElementById('alert-modal');
  if (!alertModal) return;

  document.getElementById('alert-title').textContent = title;
  document.getElementById('alert-message').textContent = message;

  alertModal.showModal();
}

// Start visual ticker updates for all cards
function startGlobalTicker() {
  if (tickerInterval) clearInterval(tickerInterval);

  tickerInterval = setInterval(() => {
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
            showAlertModal("Task Deadline Reached ⏰", `The task "${task.title}" is due now!`);
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
            showAlertModal("Timer Completed ⏱️", `The timer for task "${task.title}" has finished!`);
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
    const draggedCard = document.querySelector('.dragging');
    
    // Add visual cues to highlight column
    const column = container.closest('.board-column');
    column.classList.add('drag-over');

    if (draggedCard) {
      if (afterElement == null) {
        container.appendChild(draggedCard);
      } else {
        container.insertBefore(draggedCard, afterElement);
      }
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

    // Determine insertion position based on current DOM order in container
    const cardOrder = [...container.querySelectorAll('.task-card')].map(card => card.id);
    const targetIndex = cardOrder.indexOf(draggedTaskId);

    // Perform mutation
    moveTask(draggedTaskId, draggedSourceListId, targetListId, targetIndex >= 0 ? targetIndex : null);
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
  let totalTasks = 0;
  let activeTimers = 0;
  let completedTasks = 0;

  state.lists.forEach((list, index) => {
    totalTasks += list.tasks.length;
    
    list.tasks.forEach(task => {
      if (task.timer && task.timer.state === 'running') {
        activeTimers++;
      }
      if (task.completed) {
        completedTasks++;
      }
    });
  });

  const statTasks = document.getElementById('stat-tasks');
  const statTimers = document.getElementById('stat-timers');
  const statCompleted = document.getElementById('stat-completed');

  if (statTasks) statTasks.querySelector('.stat-value').textContent = totalTasks;
  if (statTimers) statTimers.querySelector('.stat-value').textContent = activeTimers;
  if (statCompleted) statCompleted.querySelector('.stat-value').textContent = completedTasks;
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
}
