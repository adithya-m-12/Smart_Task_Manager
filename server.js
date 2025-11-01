const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const sanitizeMongoUri = (uri) => {
  if (!uri) return "[not provided]";
  try {
    const parsed = new URL(uri);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch (error) {
    return "[provided but could not be parsed for sanitization]";
  }
};

// --- BEGIN DETAILED REQUEST LOGGER ---
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] --- Incoming Request ---`);
  console.log(`Method: ${req.method}`);
  console.log(`URL: ${req.originalUrl}`);
  console.log("Headers:", JSON.stringify(req.headers, null, 2));
  next();
});
// --- END DETAILED REQUEST LOGGER ---

// Middleware
app.use(express.json());
app.use(cors());

// --- Log body after express.json() has parsed it ---
app.use((req, res, next) => {
  if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
    if (req.body) {
      console.log("Parsed Body:", JSON.stringify(req.body, null, 2));
    } else {
      console.log("Body: (empty or not parsed by express.json)");
    }
  }
  next();
});
// ---

app.use(express.static('public'));

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/task_manager';

mongoose.connect(MONGODB_URI, {
  serverSelectionTimeoutMS: 5000,
  retryWrites: true,
  w: 'majority'
})
.then(() => console.log("✅ Connected to MongoDB"))
.catch(err => {
  console.error("❌ MongoDB connection error:", err.message);
  console.log(`Attempted MONGODB_URI: ${sanitizeMongoUri(MONGODB_URI)}`);
  console.log("Ensure MongoDB is running and accessible. Check connection string, firewall, and MongoDB logs.");
});

// Task Schema
const TaskSchema = new mongoose.Schema({
  text: { type: String, required: true },
  priority: { type: String, enum: ["High", "Medium", "Low"], default: "Medium" },
  date: { type: String, required: true },
  time: { type: String, required: true },
  completed: { type: Boolean, default: false },
  archived: { type: Boolean, default: false }
}, { timestamps: true });

const Task = mongoose.model('Task', TaskSchema);

const normalizePriority = (priorityStr) => {
  if (!priorityStr) return "Medium";
  const p = priorityStr.toLowerCase().trim();
  if (p.startsWith("h")) return "High";
  if (p.startsWith("m")) return "Medium";
  if (p.startsWith("l")) return "Low";
  return "Medium";
};

const fallbackParse = (text) => {
  console.log("🔄 Using fallback parser for text:", text);
  const dateRegex = /(next\s+(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)/i;
  const timeRegex = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i;
  const priorityRegex = /(high|medium|low)\s*(priority)?|(hi|med|lo|h|m|l)(\s*priority)?/i;

  // Extract but do not remove from text
  const dateMatch = text.match(dateRegex);
  const timeMatch = text.match(timeRegex);
  const priorityMatch = text.match(priorityRegex);

  let extractedPriority = "Medium";
  if (priorityMatch) {
    extractedPriority = normalizePriority(priorityMatch[1] || priorityMatch[3]);
  }
  const extractedDate = dateMatch?.[0] ? dateMatch[0].trim() : null;
  const extractedTime = timeMatch?.[0] ? timeMatch[0].trim() : null;

  console.log("DEBUG fallbackParse: extractedDate=", extractedDate, "extractedTime=", extractedTime, "priority=", extractedPriority);

  // Only remove trailing date/time/priority if at the end
  let taskText = text
    .replace(/\s*(?:at\s*)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)(?=\s*$)/i, '')
    .replace(/\s*(?:on\s*)?(next\s+(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|tomorrow|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)(?=\s*$)/i, '')
    .replace(/\s*(high|medium|low|hi|med|lo|h|m|l)\s*priority?(?=\s*$)/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!taskText) taskText = text; // fallback to original if empty

  console.log("Extracted components:", {
      text: taskText,
      date: extractedDate,
      time: extractedTime,
      priority: extractedPriority
  });

  const result = {
    text: taskText || "Untitled Task",
    date: extractedDate ? formatDate(extractedDate) : new Date().toISOString().split('T')[0],
    time: extractedTime ? formatTime(extractedTime) : "12:00",
    priority: extractedPriority
  };

  console.log("✅ Fallback parse result:", result);
  return result;
};

async function extractTaskWithOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions';

  const systemPrompt = `
You are a helpful assistant that extracts structured task information from user input.
Given a prompt, return a JSON object with the following fields:
- text: the main task description (string)
- date: the date (string, e.g. 'tomorrow', 'next Thursday', '05/10/2025', or ISO format)
- time: the time (string, e.g. '3pm', '14:00', or '12:00')
- priority: one of 'High', 'Medium', or 'Low'
If a field is missing, use null.
Return only the JSON object.
`;

  const response = await axios.post(
    endpoint,
    {
      model: "tokyotech-llm/llama-3.1-swallow-8b-instruct-v0.3",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      max_tokens: 256,
      temperature: 0.2
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000", // Required by OpenRouter
        "X-Title": "Task Manager" // Optional but recommended
      }
    }
  );

  const content = response.data.choices[0].message.content;
  try {
    return JSON.parse(content);
  } catch (e) {
    throw new Error("OpenRouter API did not return valid JSON: " + content);
  }
}

app.post('/ai-task', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: "No prompt provided" });
  }

  try {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error("No OPENROUTER_API_KEY found in .env");
    }
    const openRouterTask = await extractTaskWithOpenRouter(prompt);
    console.log('🟢 OpenRouter API returned:', openRouterTask);
    const fallback = fallbackParse(prompt);
    const parsed = {
      text: openRouterTask.text || fallback.text || "Untitled Task",
      date: fallback.date,
      time: fallback.time,
      priority: fallback.priority
    };
    return res.json({ task: parsed });
  } catch (error) {
    console.error("❌ OpenRouter AI processing error, using fallback:", error.message);
    return res.json({ task: fallbackParse(prompt) });
  }
});

function formatDate(rawDate) {
  console.log("DEBUG formatDate: rawDate=", rawDate);
  if (!rawDate) {
      console.log("No date provided, using today");
      return new Date().toISOString().split('T')[0];
  }
  
  console.log("Processing date:", rawDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  console.log("Today's date:", today.toISOString().split('T')[0]);
  
  // Handle "tomorrow"
  if (rawDate.toLowerCase().trim() === 'tomorrow') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = tomorrow.toISOString().split('T')[0];
      console.log("Tomorrow's date calculation:", {
          today: today.toISOString().split('T')[0],
          tomorrow: tomorrowStr,
          todayTime: today.getTime(),
          tomorrowTime: tomorrow.getTime()
      });
      return tomorrowStr;
  }
  
  // Handle "next [day]" (abbreviated and full names)
  const dayMap = {
    sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
    sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6
  };
  if (rawDate.toLowerCase().startsWith('next')) {
      const match = rawDate.toLowerCase().match(/next\s+(\w+)/);
      console.log("DEBUG formatDate: next day match=", match);
      if (match && dayMap.hasOwnProperty(match[1])) {
          const targetDay = dayMap[match[1]];
          const nextDay = new Date(today);
          let currentDay = nextDay.getDay();
          let diff = targetDay - currentDay;
          if (diff <= 0) diff += 7;
          nextDay.setDate(nextDay.getDate() + diff);
          console.log("Next day date:", nextDay.toISOString().split('T')[0]);
          return nextDay.toISOString().split('T')[0];
      }
  }
  
  // Handle numeric dates (MM/DD or MM-DD)
  const numericMatch = rawDate.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (numericMatch) {
      const [_, month, day, year] = numericMatch;
      const date = new Date(today);
      date.setMonth(parseInt(month) - 1);
      date.setDate(parseInt(day));
      if (year) {
          date.setFullYear(parseInt(year));
      } else {
          // If no year provided, use current year or next year if date has passed
          if (date < today) {
              date.setFullYear(today.getFullYear() + 1);
          } else {
              date.setFullYear(today.getFullYear());
          }
      }
      console.log("Numeric date parsed:", date.toISOString().split('T')[0]);
      return date.toISOString().split('T')[0];
  }
  
  // Try parsing as ISO date
  const parsedDate = new Date(rawDate);
  if (!isNaN(parsedDate.getTime())) {
      parsedDate.setHours(0, 0, 0, 0);
      console.log("ISO date parsed:", parsedDate.toISOString().split('T')[0]);
      return parsedDate.toISOString().split('T')[0];
  }
  
  console.warn(`⚠️ Could not parse date: "${rawDate}", defaulting to today`);
  return today.toISOString().split('T')[0];
}

function formatTime(rawTime) {
    if (!rawTime) return "12:00";
    
    // Handle "HH:MM AM/PM" format
    const timeMatch = rawTime.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (timeMatch) {
        let [_, hours, minutes = "00", ampm] = timeMatch;
        hours = parseInt(hours);
        
        // Convert to 24-hour format
        if (ampm) {
            ampm = ampm.toLowerCase();
            if (ampm === 'pm' && hours < 12) hours += 12;
            if (ampm === 'am' && hours === 12) hours = 0;
        }
        
        return `${hours.toString().padStart(2, '0')}:${minutes.padStart(2, '0')}`;
    }
    
    // Try parsing as ISO time
    const time = new Date(`2000-01-01T${rawTime}`);
    if (!isNaN(time.getTime())) {
        return time.toISOString().split('T')[1].slice(0, 5);
    }
    
    console.warn(`⚠️ Could not parse time: "${rawTime}", defaulting to 12:00`);
    return "12:00";
}

// --- REST Routes ---
app.get('/tasks', async (req, res) => {
  console.log("GET /tasks query:", req.query);
  try {
    const { q, filter = "all" } = req.query;
    let query = {};
    if (filter === "active") query.archived = false;
    else if (filter === "archived") query.archived = true;
    if (q && q.length > 0) {
      query.text = { $regex: q, $options: 'i' };
    }
    const tasks = await Task.find(query).sort({date: 1, time: 1});
    console.log(`✅ Found ${tasks.length} tasks for filter '${filter}' and query '${q || ""}'`);
    res.json(tasks);
  } catch (error) {
    console.error("❌ Error fetching tasks:", error);
    res.status(500).json({ error: "Failed to fetch tasks: " + error.message });
  }
});

app.post('/tasks', async (req, res) => {
  console.log("Attempting to create task with body:", req.body);
  try {
    const { text, date, time, priority } = req.body;
    if (!text || !date || !time) {
      let missingFields = [];
      if (!text) missingFields.push("text");
      if (!date) missingFields.push("date");
      if (!time) missingFields.push("time");
      console.warn(`⚠️ Missing fields for new task: ${missingFields.join(', ')}`);
      return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
    }
    
    const task = new Task({ text, date, time, priority: priority || "Medium" });
    await task.save();
    console.log("✅ Task created successfully:", task);
    res.status(201).json(task);
  } catch (error) {
    console.error("❌ Error creating task:", error);
    if (error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error while creating task: " + error.message });
  }
});

app.patch('/tasks/:id', async (req, res) => {
  console.log(`PATCH /tasks/${req.params.id} with body:`, req.body);
  try {
    const task = await Task.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!task) {
      console.warn(`⚠️ Task not found with ID: ${req.params.id}`);
      return res.status(404).json({ error: "Task not found" });
    }
    console.log("✅ Task updated successfully:", task);
    res.status(200).json(task);
  } catch (error) {
    console.error("❌ Error updating task:", error);
    if (error.name === 'ValidationError') {
        return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: "Server error while updating task: " + error.message });
  }
});

app.delete('/tasks/:id', async (req, res) => {
  console.log(`DELETE /tasks/${req.params.id}`);
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) {
      console.warn(`⚠️ Task not found with ID: ${req.params.id}`);
      return res.status(404).json({ error: "Task not found" });
    }
    console.log("✅ Task deleted successfully:", task);
    res.status(204).end();
  } catch (error) {
    console.error("❌ Error deleting task:", error);
    res.status(500).json({ error: "Server error while deleting task: " + error.message });
  }
});

app.delete('/tasks', async (req, res) => {
  try {
    const result = await Task.deleteMany({});
    console.log(`✅ Deleted all tasks. Count: ${result.deletedCount}`);
    res.status(204).end();
  } catch (error) {
    console.error("❌ Error deleting all tasks:", error);
    res.status(500).json({ error: "Server error while deleting all tasks: " + error.message });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server is running on port ${PORT}`);
});