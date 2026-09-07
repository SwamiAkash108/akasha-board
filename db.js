/* db.js — data layer. Supabase when configured, demo mode otherwise.
   v4: per-project columns, people roster, task assignees. */
(function () {
  const cfg = window.APP_CONFIG || {};
  const DEMO = !cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY;
  let sb = null;
  if (!DEMO && window.supabase) {
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  }

  /* ---------- demo data ---------- */
  const uid = () => Math.random().toString(36).slice(2, 10);
  const today = new Date();
  const d = (offset) => {
    const t = new Date(today); t.setDate(t.getDate() + offset);
    return t.toISOString().slice(0, 10);
  };
  const DEFAULT_COLS = [
    { name: "To do", color: "#8a7f6b" },
    { name: "Doing", color: "#c9912f" },
    { name: "Blocked", color: "#b3352c" },
    { name: "Done", color: "#6b7040" },
  ];
  const demoProjects = [
    { id: "p1", name: "Tadatmya Essentials", color: "#e8a33d", status: "active", created_at: new Date().toISOString() },
    { id: "p2", name: "Website Relaunch", color: "#c96f3f", status: "active", created_at: new Date().toISOString() },
    { id: "p3", name: "Kirtan Album", color: "#7ba05b", status: "active", created_at: new Date().toISOString() },
  ];
  const demoColumns = demoProjects.flatMap((p) =>
    DEFAULT_COLS.map((c, i) => ({ id: uid(), project_id: p.id, name: c.name, color: c.color, position: i + 1, created_at: new Date().toISOString() }))
  );
  const demoPeople = [
    { id: "u1", name: "Akash", color: "#b3352c", created_at: new Date().toISOString() },
    { id: "u2", name: "Fluso", color: "#2b4361", created_at: new Date().toISOString() },
  ];
  const demoTasks = [
    { id: uid(), project_id: "p1", title: "Collect source material", status: "Done", priority: 2, start: d(-20), due: d(-12), position: 1, assignees: ["u1"] },
    { id: uid(), project_id: "p1", title: "Structure and outline", status: "Done", priority: 2, start: d(-11), due: d(-6), position: 2, assignees: ["u1"] },
    { id: uid(), project_id: "p1", title: "First draft", status: "Doing", priority: 3, start: d(-5), due: d(9), position: 1, assignees: ["u1"] },
    { id: uid(), project_id: "p1", title: "Editing, content and copy", status: "To do", priority: 2, start: d(10), due: d(20), position: 2, assignees: [] },
    { id: uid(), project_id: "p1", title: "Sanskrit / IAST check", status: "To do", priority: 2, start: d(21), due: d(25), position: 3, assignees: ["u2"] },
    { id: uid(), project_id: "p1", title: "Proofreading", status: "To do", priority: 1, start: d(26), due: d(30), position: 4, assignees: [] },
    { id: uid(), project_id: "p2", title: "Homepage hero design", status: "Doing", priority: 3, start: d(-3), due: d(4), position: 1, assignees: ["u1"] },
    { id: uid(), project_id: "p2", title: "Migrate old content", status: "Blocked", priority: 2, start: d(-8), due: d(-1), position: 1, assignees: [] },
    { id: uid(), project_id: "p3", title: "Record track 4", status: "To do", priority: 2, start: d(3), due: d(12), position: 1, assignees: ["u1"] },
  ].map(t => ({ notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...t }));
  const demoUpdates = [
    { id: uid(), project_id: "p1", author: "fluso", text: "Project created from your voice note via @fluso_pm_bot. 12 publication stages added as tasks.", created_at: new Date(Date.now() - 3600e3).toISOString() },
    { id: uid(), project_id: "p2", author: "akash", text: "Hero concept approved, moving to final design this week.", created_at: new Date(Date.now() - 7200e3).toISOString() },
  ];
  const demo = { projects: demoProjects, columns: demoColumns, people: demoPeople, tasks: demoTasks, updates: demoUpdates };

  async function seedColumns(projectId) {
    const rows = DEFAULT_COLS.map((c, i) => ({ project_id: projectId, name: c.name, color: c.color, position: i + 1 }));
    if (DEMO) {
      const made = rows.map((r) => ({ id: uid(), created_at: new Date().toISOString(), ...r }));
      demo.columns.push(...made);
      return made;
    }
    const { data, error } = await sb.from("columns").insert(rows).select();
    if (error) throw error;
    return data;
  }

  /* ---------- API ---------- */
  const DB = {
    demo: DEMO,
    DEFAULT_COLS,

    async session() {
      if (DEMO) return { demo: true };
      const { data } = await sb.auth.getSession();
      return data.session;
    },
    async signIn(email, pass) {
      const { error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
    },
    async signOut() { if (!DEMO) await sb.auth.signOut(); },

    async loadAll() {
      if (DEMO) return JSON.parse(JSON.stringify(demo));
      const [p, c, pe, t, u] = await Promise.all([
        sb.from("projects").select("*").order("created_at"),
        sb.from("columns").select("*").order("position"),
        sb.from("people").select("*").order("created_at"),
        sb.from("tasks").select("*").order("position"),
        sb.from("updates").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (p.error) throw p.error; if (c.error) throw c.error; if (pe.error) throw pe.error;
      if (t.error) throw t.error; if (u.error) throw u.error;
      return { projects: p.data, columns: c.data, people: pe.data, tasks: t.data, updates: u.data };
    },

    async addProject(name) {
      const row = { name, status: "active" };
      if (DEMO) {
        const p = { id: uid(), color: "#e8a33d", created_at: new Date().toISOString(), ...row };
        demo.projects.push(p);
        p._columns = await seedColumns(p.id);
        return p;
      }
      const { data, error } = await sb.from("projects").insert(row).select().single();
      if (error) throw error;
      data._columns = await seedColumns(data.id);
      return data;
    },

    /* ----- columns ----- */
    async addColumn(project_id, name, color = "#8a7f6b", position = Date.now()) {
      const row = { project_id, name, color, position };
      if (DEMO) { const c = { id: uid(), created_at: new Date().toISOString(), ...row }; demo.columns.push(c); return c; }
      const { data, error } = await sb.from("columns").insert(row).select().single();
      if (error) throw error; return data;
    },
    async updateColumn(id, patch) {
      if (DEMO) { Object.assign(demo.columns.find(c => c.id === id), patch); return; }
      const { error } = await sb.from("columns").update(patch).eq("id", id);
      if (error) throw error;
    },
    async deleteColumn(id) {
      if (DEMO) { demo.columns = demo.columns.filter(c => c.id !== id); return; }
      const { error } = await sb.from("columns").delete().eq("id", id);
      if (error) throw error;
    },

    /* ----- people ----- */
    async addPerson(name, color = "#2b4361") {
      const row = { name, color };
      if (DEMO) { const p = { id: uid(), created_at: new Date().toISOString(), ...row }; demo.people.push(p); return p; }
      const { data, error } = await sb.from("people").insert(row).select().single();
      if (error) throw error; return data;
    },
    async deletePerson(id) {
      if (DEMO) {
        demo.people = demo.people.filter(p => p.id !== id);
        demo.tasks.forEach(t => { t.assignees = (t.assignees || []).filter(x => x !== id); });
        return;
      }
      const { error } = await sb.from("people").delete().eq("id", id);
      if (error) throw error;
    },

    /* ----- tasks ----- */
    async addTask(task) {
      const row = { status: "To do", priority: 2, notes: "", position: Date.now(), ...task };
      if (DEMO) { const t = { id: uid(), created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...row }; demo.tasks.push(t); return t; }
      const { data, error } = await sb.from("tasks").insert(row).select().single();
      if (error) throw error; return data;
    },
    async updateTask(id, patch) {
      patch.updated_at = new Date().toISOString();
      if (DEMO) { Object.assign(demo.tasks.find(t => t.id === id), patch); return; }
      const { error } = await sb.from("tasks").update(patch).eq("id", id);
      if (error) throw error;
    },
    async deleteTask(id) {
      if (DEMO) { demo.tasks = demo.tasks.filter(t => t.id !== id); return; }
      const { error } = await sb.from("tasks").delete().eq("id", id);
      if (error) throw error;
    },

    async deleteProject(id) {
      if (DEMO) {
        demo.projects = demo.projects.filter(p => p.id !== id);
        demo.columns = demo.columns.filter(c => c.project_id !== id);
        demo.tasks = demo.tasks.filter(t => t.project_id !== id);
        demo.updates = demo.updates.filter(u => u.project_id !== id);
        return;
      }
      const { error } = await sb.from("projects").delete().eq("id", id);
      if (error) throw error;
    },

    async addUpdate(project_id, text, author = "akash") {
      const row = { project_id, text, author };
      if (DEMO) { const u = { id: uid(), created_at: new Date().toISOString(), ...row }; demo.updates.unshift(u); return u; }
      const { data, error } = await sb.from("updates").insert(row).select().single();
      if (error) throw error; return data;
    },
    /* ----- chat ----- */
    async loadChat(limit = 100) {
      if (DEMO) return demo.chat || [];
      const { data, error } = await sb.from("chat").select("*").order("created_at", { ascending: true }).limit(limit);
      if (error) throw error;
      return data;
    },
    async addChat(role, text) {
      const row = { role, text };
      if (DEMO) { const c = { id: uid(), created_at: new Date().toISOString(), ...row }; (demo.chat = demo.chat || []).push(c); return c; }
      const { data, error } = await sb.from("chat").insert(row).select().single();
      if (error) throw error; return data;
    },
  };

  window.DB = DB;
  DB.client = sb;
})();
