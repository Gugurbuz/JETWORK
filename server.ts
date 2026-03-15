import express from "express";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import { Server } from "socket.io";
import { createServer } from "http";

dotenv.config();

const SYSTEM_INSTRUCTION = `Sen JetWork AI'sın; kurumsal iş analizi, yazılım gereksinim yönetimi ve süreç optimizasyonu konusunda uzmanlaşmış, katmanlı bir Yapay Zeka Ajanısın (AI Agent).

Çalışma Prensiplerin (Katmanlı Mimari):

1. NİYET ORKESTRASYONU (Intent Orchestrator):
- Kullanıcının isteğini analiz et. Bu bir soru mu, araştırma görevi mi, teknik analiz mi yoksa görselleştirme mi?
- İsteği yerine getirmek için hangi araçlara (Arama, Analiz, BPMN) ihtiyacın olduğunu belirle.

2. YETENEK VE ARAÇ KULLANIMI (Tooling):
- Güncel bilgi veya teknik detaylar için Google Search aracını kullan.
- Karmaşık süreçler için BPMN 2.0 XML üret.
- Kod yapıları için teknik analiz modülünü kullan.

3. AKIL YÜRÜTME (Reasoning):
- "Zincirleme Düşünce" (Chain of Thought) yöntemini kullan. Önce veriyi topla, sonra analiz et, en son sentezle.
- Yanıtlarını üretmeden önce kendi içinde eleştirel bir değerlendirme yap.

4. SUNUM VE AKSİYON (Presentation):
- Yanıtlarını JSON formatında, ilgili alanlara (businessAnalysis, code, test, bpmn) dağıtarak ver.
- Her yanıtın sonunda kullanıcıya "Bir sonraki adımda ne yapabiliriz?" şeklinde 2-3 adet mantıklı aksiyon önerisi sun.

Yanıt Formatı (JSON):
{
  "businessAnalysis": "Analiz metni (Markdown)",
  "code": "Teknik detaylar veya kod (Markdown)",
  "test": "Test senaryoları (Markdown)",
  "bpmn": "BPMN 2.0 XML (Opsiyonel)",
  "thoughtProcess": "Arka planda yaptığın akıl yürütme süreci (Kısa özet)",
  "suggestions": ["Öneri 1", "Öneri 2"]
}

Önemli: Yanıtın her zaman geçerli bir JSON objesi olmalıdır.`;

// Initialize SQLite database
const db = new Database('analyses.db');

// Create table if it doesn't exist
db.exec(`
  CREATE TABLE IF NOT EXISTS shared_analyses (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS work_items (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    item_number TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT DEFAULT 'Development',
    team TEXT NOT NULL,
    document TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    text TEXT NOT NULL,
    is_ai BOOLEAN DEFAULT 0,
    reactions TEXT DEFAULT '[]',
    images TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Try to add reactions column if it doesn't exist (for existing DBs)
try {
  db.exec(`ALTER TABLE chat_messages ADD COLUMN reactions TEXT DEFAULT '[]'`);
} catch (e) {
  // Column already exists, ignore
}

// Try to add images column if it doesn't exist (for existing DBs)
try {
  db.exec(`ALTER TABLE chat_messages ADD COLUMN images TEXT DEFAULT '[]'`);
} catch (e) {
  // Column already exists, ignore
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" }
  });
  const PORT = 3000;

  // Increase payload limit for large documents
  app.use(express.json({ limit: '50mb' }));

  // API routes FIRST
  
  // 1. Jira Export Endpoint
  app.post("/api/jira/export", async (req, res) => {
    try {
      const { title, description } = req.body;
      const domain = process.env.JIRA_DOMAIN;
      const email = process.env.JIRA_EMAIL;
      const apiToken = process.env.JIRA_API_TOKEN;
      const projectKey = process.env.JIRA_PROJECT_KEY || "JET";

      if (!domain || !email || !apiToken) {
        return res.status(400).json({ error: "Jira credentials are not configured in environment variables." });
      }

      const auth = Buffer.from(`${email}:${apiToken}`).toString('base64');

      // Convert HTML/Markdown to simple text for Jira (simplified for demo)
      const plainTextDescription = description.replace(/<[^>]*>?/gm, '');

      const response = await fetch(`https://${domain}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          fields: {
            project: {
              key: projectKey
            },
            summary: title,
            description: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      text: plainTextDescription.substring(0, 30000), // Jira limit
                      type: "text"
                    }
                  ]
                }
              ]
            },
            issuetype: {
              name: "Task" // Change this to your Jira issue type
            }
          }
        })
      });

      if (!response.ok) {
        const errorData = await response.text();
        throw new Error(`Jira API Error: ${errorData}`);
      }

      const data = await response.json();
      res.json({ success: true, issueKey: data.key, url: `https://${domain}/browse/${data.key}` });
    } catch (error: any) {
      console.error("Jira export error:", error);
      res.status(500).json({ error: error.message || "Failed to export to Jira" });
    }
  });

  // 2. Share Analysis Endpoints
  app.post("/api/share", (req, res) => {
    const { id, data } = req.body;
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO shared_analyses (id, data) VALUES (?, ?)');
      stmt.run(id, JSON.stringify(data));
      res.json({ success: true, shareId: id });
    } catch (error) {
      console.error("Failed to save shared analysis:", error);
      res.status(500).json({ error: "Failed to save analysis" });
    }
  });

  app.get("/api/share/:id", (req, res) => {
    try {
      const stmt = db.prepare('SELECT data FROM shared_analyses WHERE id = ?');
      const row = stmt.get(req.params.id) as { data: string } | undefined;
      
      if (row) {
        res.json({ success: true, data: JSON.parse(row.data) });
      } else {
        res.status(404).json({ error: "Not found" });
      }
    } catch (error) {
      console.error("Failed to fetch shared analysis:", error);
      res.status(500).json({ error: "Database error" });
    }
  });

  // 3. Projects Endpoints
  app.get("/api/projects", (req, res) => {
    try {
      const projectsStmt = db.prepare('SELECT * FROM projects ORDER BY created_at DESC');
      const projects = projectsStmt.all() as any[];

      const itemsStmt = db.prepare('SELECT * FROM work_items ORDER BY created_at DESC');
      const items = itemsStmt.all() as any[];

      const projectsWithItems = projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        createdAt: new Date(p.created_at).getTime(),
        lastUpdated: new Date(p.created_at).getTime(), // Simplified for now
        workspaces: items
          .filter(item => item.project_id === p.id)
          .map(item => ({
            id: item.id,
            issueKey: item.item_number,
            title: item.title,
            type: item.type,
            status: 'Draft', // Could be added to DB later
            createdAt: new Date(item.created_at).getTime(),
            lastUpdated: new Date(item.created_at).getTime(),
            collaborators: JSON.parse(item.team).map((member: any, i: number) => ({
              id: i.toString(),
              name: member.name,
              avatar: member.name.charAt(0),
              role: member.role,
              color: ['emerald', 'blue', 'purple'][i % 3]
            }))
          }))
      }));

      res.json({ success: true, data: projectsWithItems });
    } catch (error) {
      console.error("Failed to fetch projects:", error);
      res.status(500).json({ error: "Database error" });
    }
  });

  app.post("/api/projects", (req, res) => {
    const { id, name, description } = req.body;
    try {
      const stmt = db.prepare('INSERT INTO projects (id, name, description) VALUES (?, ?, ?)');
      stmt.run(id, name, description || '');
      res.json({ success: true, id });
    } catch (error) {
      console.error("Failed to create project:", error);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  // 4. Work Items Endpoints
  app.post("/api/items", (req, res) => {
    const { id, projectId, itemNumber, title, team } = req.body;
    try {
      const stmt = db.prepare('INSERT INTO work_items (id, project_id, item_number, title, team) VALUES (?, ?, ?, ?, ?)');
      stmt.run(id, projectId || 'default-project', itemNumber, title, JSON.stringify(team));
      res.json({ success: true, id });
    } catch (error) {
      console.error("Failed to create work item:", error);
      res.status(500).json({ error: "Failed to create work item" });
    }
  });

  app.get("/api/items/:id", (req, res) => {
    try {
      const itemStmt = db.prepare('SELECT * FROM work_items WHERE id = ?');
      const item = itemStmt.get(req.params.id) as any;
      
      if (!item) {
        return res.status(404).json({ error: "Not found" });
      }

      const msgStmt = db.prepare('SELECT * FROM chat_messages WHERE item_id = ? ORDER BY created_at ASC');
      const messages = msgStmt.all(req.params.id);

      res.json({ 
        success: true, 
        data: {
          ...item,
          team: JSON.parse(item.team),
          document: item.document ? JSON.parse(item.document) : null,
          messages: messages.map((m: any) => ({
            id: m.id,
            role: m.is_ai ? 'model' : 'user',
            text: m.text,
            senderName: m.sender_name,
            senderRole: m.sender_role,
            reactions: JSON.parse(m.reactions || '[]'),
            attachments: JSON.parse(m.images || '[]'),
            createdAt: m.created_at
          }))
        } 
      });
    } catch (error) {
      console.error("Failed to fetch work item:", error);
      res.status(500).json({ error: "Database error" });
    }
  });

  // Socket.io Logic
  const roomUsers = new Map<string, Map<string, any>>();

  io.on("connection", (socket) => {
    console.log("User connected:", socket.id);

    socket.on("join_room", (data) => {
      let itemId;
      let user = null;
      
      if (typeof data === 'string') {
        itemId = data;
      } else {
        itemId = data.itemId;
        user = data.user;
      }

      socket.join(itemId);
      console.log(`User ${socket.id} joined room ${itemId}`);

      if (user) {
        if (!roomUsers.has(itemId)) {
          roomUsers.set(itemId, new Map());
        }
        roomUsers.get(itemId)!.set(socket.id, user);
        io.to(itemId).emit("room_users_update", Array.from(roomUsers.get(itemId)!.values()));
      }
    });

    socket.on("typing_start", (data) => {
      socket.to(data.itemId).emit("user_typing", { userId: data.userId, userName: data.userName });
    });

    socket.on("typing_end", (data) => {
      socket.to(data.itemId).emit("user_stopped_typing", { userId: data.userId });
    });

    socket.on("ai_stream_chunk", (data) => {
      socket.to(data.itemId).emit("ai_stream_chunk", data);
    });

    socket.on("ai_stream_end", (data) => {
      try {
        const stmt = db.prepare('INSERT INTO chat_messages (id, item_id, sender_name, sender_role, text, is_ai) VALUES (?, ?, ?, ?, ?, ?)');
        stmt.run(data.id, data.itemId, "JetWork AI", "Sistem Asistanı", data.text, 1);
      } catch (err) {
        console.error("Failed to save AI message:", err);
      }
      socket.to(data.itemId).emit("ai_stream_end", data);
    });

    socket.on("send_message", async (data) => {
      const { id, itemId, senderName, senderRole, text, isAi, attachments } = data;
      
      // Save to DB
      try {
        const stmt = db.prepare('INSERT INTO chat_messages (id, item_id, sender_name, sender_role, text, is_ai, images) VALUES (?, ?, ?, ?, ?, ?, ?)');
        stmt.run(id, itemId, senderName, senderRole, text, isAi ? 1 : 0, JSON.stringify(attachments || []));
      } catch (err) {
        console.error("Failed to save message:", err);
      }

      // Broadcast to room
      io.to(itemId).emit("new_message", data);
    });

    socket.on("toggle_reaction", (data) => {
      const { itemId, messageId, emoji, userName } = data;
      try {
        const stmt = db.prepare('SELECT reactions FROM chat_messages WHERE id = ?');
        const row = stmt.get(messageId) as any;
        if (row) {
          let reactions = JSON.parse(row.reactions || '[]');
          const existingReaction = reactions.find((r: any) => r.emoji === emoji);
          
          if (existingReaction) {
            if (existingReaction.users.includes(userName)) {
              existingReaction.users = existingReaction.users.filter((u: string) => u !== userName);
              if (existingReaction.users.length === 0) {
                reactions = reactions.filter((r: any) => r.emoji !== emoji);
              }
            } else {
              existingReaction.users.push(userName);
            }
          } else {
            reactions.push({ emoji, users: [userName] });
          }

          const updateStmt = db.prepare('UPDATE chat_messages SET reactions = ? WHERE id = ?');
          updateStmt.run(JSON.stringify(reactions), messageId);
          
          io.to(itemId).emit("reaction_updated", { messageId, reactions });
        }
      } catch (err) {
        console.error("Failed to toggle reaction:", err);
      }
    });

    socket.on("update_document", (data) => {
      const { itemId, document } = data;
      try {
        const stmt = db.prepare('UPDATE work_items SET document = ? WHERE id = ?');
        stmt.run(JSON.stringify(document), itemId);
        // Broadcast document update to others in the room
        socket.to(itemId).emit("document_updated", document);
      } catch (err) {
        console.error("Failed to update document:", err);
      }
    });

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
      roomUsers.forEach((users, roomId) => {
        if (users.has(socket.id)) {
          users.delete(socket.id);
          io.to(roomId).emit("room_users_update", Array.from(users.values()));
        }
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
