document.addEventListener("DOMContentLoaded", () => {
    const taskList = document.getElementById("task-list");
    const addTaskBtn = document.getElementById("add-task-btn");
    const taskNameInput = document.getElementById("task-name");
    const dateInput = document.getElementById("task-date");
    const timeInput = document.getElementById("task-time");
    const priorityInput = document.getElementById("task-priority");
    const aiQuickAddBtn = document.getElementById("ai-quick-add");
    const aiTaskInput = document.getElementById("ai-task-input");
    const searchInput = document.getElementById("search-task");
    const filterAllBtn = document.getElementById("filter-all");
    const filterActiveBtn = document.getElementById("filter-active");
    const filterArchivedBtn = document.getElementById("filter-archived");
    const archiveTasksBtn = document.getElementById("archive-tasks-btn");
    const clearTasksBtn = document.getElementById("clear-tasks-btn");
    const taskCount = document.getElementById("task-count");

    let currentFilter = "all";
    
    const API_BASE_URL = 'http://localhost:3000';

    const today = new Date().toISOString().split('T')[0];
    dateInput.value = today;
    timeInput.value = "12:00";

    const setActiveFilter = (filter) => {
        [filterAllBtn, filterActiveBtn, filterArchivedBtn].forEach(btn => {
            btn.classList.remove("active");
        });
        if (filter === "all") filterAllBtn.classList.add("active");
        else if (filter === "active") filterActiveBtn.classList.add("active");
        else if (filter === "archived") filterArchivedBtn.classList.add("active");
    };

    const showError = (message, isCritical = false) => {
        console.error("UI Error Displayed:", message);
        const errorLi = document.createElement("li");
        errorLi.className = "error-message";
        errorLi.textContent = message;
        taskList.innerHTML = ""; 
        taskList.appendChild(errorLi);
        if (isCritical) {
            // Maybe disable certain UI elements if critical error
        }
    };

    const renderTask = (task) => {
        const li = document.createElement("li");
        li.classList.add(task.priority.toLowerCase());
        if (task.completed) li.classList.add("completed");
        if (task.archived) li.classList.add("archived");
        li.dataset.taskId = task._id;

        const taskContent = document.createElement("div");
        taskContent.className = "task-content";
        
        const text = document.createElement("span");
        text.textContent = task.text;
        if (task.completed) text.classList.add("completed");
        
        const details = document.createElement("span");
        details.className = "task-details";
        
        // Improved date formatting
        let displayDate = "Invalid Date";
        try {
            console.log("DEBUG: task.date from backend:", task.date);
            const [year, month, day] = task.date.split('-').map(Number);
            const taskYMD = [year, month, day].join('-');
            const now = new Date();
            const todayYMD = [now.getFullYear(), now.getMonth() + 1, now.getDate()].join('-');
            const tomorrowDate = new Date(now);
            tomorrowDate.setDate(now.getDate() + 1);
            const tomorrowYMD = [tomorrowDate.getFullYear(), tomorrowDate.getMonth() + 1, tomorrowDate.getDate()].join('-');
            if (taskYMD === todayYMD) {
                displayDate = "Today";
            } else if (taskYMD === tomorrowYMD) {
                displayDate = "Tomorrow";
            } else {
                displayDate = new Date(year, month - 1, day).toLocaleDateString('en-US', {
                    weekday: 'short',
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric'
                });
            }
        } catch (e) {
            console.error("Error formatting date for display:", task.date, e);
        }

        // Improved time formatting
        let displayTime = task.time;
        try {
            const [hours, minutes] = task.time.split(':').map(Number);
            if (!isNaN(hours) && !isNaN(minutes)) {
                const time = new Date();
                time.setHours(hours, minutes);
                displayTime = time.toLocaleTimeString('en-US', {
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
            }
        } catch (e) {
            console.error("Error formatting time for display:", task.time, e);
        }

        details.textContent = `${displayDate} at ${displayTime} • ${task.priority}`;
        taskContent.appendChild(text);
        taskContent.appendChild(details);

        const actions = document.createElement("div");
        actions.className = "task-actions";

        const completeBtn = document.createElement("button");
        completeBtn.textContent = task.completed ? "Undo" : "Done";
        completeBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
                const res = await fetch(`${API_BASE_URL}/tasks/${task._id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ completed: !task.completed })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({error: `Failed to update task (HTTP ${res.status})`}));
                    throw new Error(errData.error);
                }
                await loadTasks();
            } catch (error) {
                showError("Failed to update task completion: " + error.message);
            }
        });

        const archiveBtn = document.createElement("button");
        archiveBtn.textContent = task.archived ? "Restore" : "Archive";
        archiveBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            try {
                const res = await fetch(`${API_BASE_URL}/tasks/${task._id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ archived: !task.archived })
                });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({error: `Failed to archive/restore task (HTTP ${res.status})`}));
                    throw new Error(errData.error);
                }
                await loadTasks();
            } catch (error) {
                showError("Failed to update task archive status: " + error.message);
            }
        });

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (confirm("Are you sure you want to delete this task?")) {
                await deleteTask(task._id);
            }
        });

        actions.appendChild(completeBtn);
        if (!task.completed || task.archived) {
            actions.appendChild(archiveBtn);
        }
        actions.appendChild(deleteBtn);
        li.appendChild(taskContent);
        li.appendChild(actions);
        taskList.appendChild(li);
    };

    const loadTasks = async () => {
        try {
            const queryParams = new URLSearchParams();
            if (searchInput.value) queryParams.append('q', searchInput.value);
            queryParams.append('filter', currentFilter);
            
            const res = await fetch(`${API_BASE_URL}/tasks?${queryParams.toString()}`);
            if (!res.ok) {
                let errorText = `Server returned ${res.status}: ${res.statusText}.`;
                try { errorText += " " + await res.text(); } catch {}
                throw new Error(errorText);
            }
            const tasks = await res.json();
            taskList.innerHTML = "";
            if (tasks.length === 0) {
                const noTasksLi = document.createElement("li");
                noTasksLi.textContent = "No tasks found for this filter.";
                noTasksLi.className = "info-message";
                taskList.appendChild(noTasksLi);
            } else {
                tasks.forEach(renderTask);
            }
            taskCount.textContent = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'}`;
            setActiveFilter(currentFilter);
        } catch (error) {
            showError("Failed to load tasks: " + error.message, true);
        }
    };

    const addTask = async (text, date, time, priority) => {
        if (!text || !date || !time) {
            let missingFields = [];
            if (!text) missingFields.push("task name");
            if (!date) missingFields.push("date");
            if (!time) missingFields.push("time");
            alert(`Please fill all required fields: ${missingFields.join(', ')}.`);
            return false;
        }
        console.log(`Attempting to add task via UI: Text='${text}', Date='${date}', Time='${time}', Priority='${priority}'`);
        try {
            const res = await fetch(`${API_BASE_URL}/tasks`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text, date, time, priority })
            });

            if (!res.ok) {
                let errorData = { error: `Server responded with ${res.status} ${res.statusText}` };
                try {
                    errorData = await res.json();
                } catch (e) {
                    console.warn("Could not parse error JSON from server on add task. Status:", res.status, res.statusText, e);
                    errorData.error = `Server error ${res.status}: ${res.statusText || 'Could not add task'}`;
                }
                throw new Error(errorData.error);
            }

            const newTask = await res.json();
            console.log("Task added successfully:", newTask);
            taskNameInput.value = ""; 
            aiTaskInput.value = "";   
            loadTasks();
            return true; 
        } catch (error) {
            showError("Failed to add task: " + error.message);
            console.error("Detailed error adding task from UI:", error);
            return false;
        }
    };

    const deleteTask = async (taskId) => {
        try {
            const res = await fetch(`${API_BASE_URL}/tasks/${taskId}`, { 
                method: "DELETE",
                headers: { "Content-Type": "application/json" }
            });
            
            if (!res.ok) {
                const errData = await res.json().catch(() => ({error: `Failed to delete task (HTTP ${res.status})`}));
                throw new Error(errData.error);
            }
            
            await loadTasks();
            return true;
        } catch (error) {
            showError("Failed to delete task: " + error.message);
            console.error("Delete task error:", error);
            return false;
        }
    };

    const checkServerHealth = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/health`);
            if (!res.ok) {
                throw new Error(`Health check request failed: ${res.status} ${res.statusText}`);
            }
            const data = await res.json();
            console.log("Server Health Status:", data);
            if (data.status !== 'ok' || data.mongodb !== 'connected') {
                let warningMessage = "Server Warning: ";
                if (data.mongodb !== 'connected') {
                    warningMessage += `Database is ${data.mongodb}. Tasks cannot be reliably saved or loaded. Please check server console.`;
                } else {
                    warningMessage += `Overall status: ${data.status}. Some functionalities might be affected.`;
                }
                showError(warningMessage, true);
            }
        } catch (error) {
            console.error("Server health check failed:", error);
            showError(`Unable to connect to the server at ${API_BASE_URL}. Ensure it's running. (${error.message})`, true);
        }
    };

    addTaskBtn.addEventListener("click", () => {
        addTask( taskNameInput.value.trim(), dateInput.value, timeInput.value, priorityInput.value );
    });
    taskNameInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") {
            e.preventDefault(); 
            addTask( taskNameInput.value.trim(), dateInput.value, timeInput.value, priorityInput.value );
        }
    });

    aiQuickAddBtn.addEventListener("click", async () => {
        const prompt = aiTaskInput.value.trim();
        if (!prompt) {
            alert("Please enter a task description for AI Quick Add.");
            return;
        }
        aiQuickAddBtn.textContent = "Processing...";
        aiQuickAddBtn.disabled = true;
        try {
            const res = await fetch(`${API_BASE_URL}/ai-task`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prompt })
            });
            if (!res.ok) {
                let errorData = { error: `AI service responded with ${res.status} ${res.statusText}`};
                try { errorData = await res.json(); } catch(e) {
                    console.warn("Could not parse AI error JSON:", e);
                }
                throw new Error(errorData.error || `AI parsing failed (HTTP ${res.status})`);
            }
            const data = await res.json();
            if (data.error || !data.task) {
                throw new Error(data.error || "AI parsing returned invalid or no task data.");
            }
            const { text, date, time, priority } = data.task;
            console.log("AI parsed task:", { text, date, time, priority });
            await addTask(text, date, time, priority);
            aiTaskInput.value = "";
        } catch (error) {
            showError("AI Quick Add failed: " + error.message);
            console.error("Detailed AI Quick Add error:", error);
        } finally {
            aiQuickAddBtn.textContent = "✨ AI Quick Add";
            aiQuickAddBtn.disabled = false;
        }
    });
    aiTaskInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") { e.preventDefault(); aiQuickAddBtn.click(); }
    });

    let searchTimer;
    searchInput.addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(loadTasks, 300);
    });

    filterAllBtn.addEventListener("click", () => { currentFilter = "all"; loadTasks(); });
    filterActiveBtn.addEventListener("click", () => { currentFilter = "active"; loadTasks(); });
    filterArchivedBtn.addEventListener("click", () => { currentFilter = "archived"; loadTasks(); });

    archiveTasksBtn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to archive all active tasks?")) {
            try {
                const res = await fetch(`${API_BASE_URL}/tasks/archive`, { method: "POST" });
                 if (!res.ok) {
                    const errData = await res.json().catch(() => ({error: `Failed to archive tasks (HTTP ${res.status})`}));
                    throw new Error(errData.error);
                }
                loadTasks();
            } catch (error) {
                showError("Failed to archive tasks: " + error.message);
            }
        }
    });

    clearTasksBtn.addEventListener("click", async () => {
        if (confirm("Are you sure you want to delete ALL tasks? This cannot be undone.")) {
            try {
                const res = await fetch(`${API_BASE_URL}/tasks`, { method: "DELETE" });
                if (!res.ok) {
                    const errData = await res.json().catch(() => ({error: `Failed to delete all tasks (HTTP ${res.status})`}));
                    throw new Error(errData.error);
                }
                loadTasks();
            } catch (error) {
                showError("Failed to delete all tasks: " + error.message);
            }
        }
    });

    (async () => {
        await checkServerHealth();
        loadTasks();
    })();
});