/* db.js — data layer. Supabase when configured, demo mode otherwise. */
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
  const demoProjects = [
    { id: "p1", name: "Tadatmya Essentials", color: "#e8a33d", status: "active", created_at: new Date().toISOString() },
    { id: "p2", name: "Website Relaunch", color: "#c96f3f", status: "active", created_at: new Date().toISOString() },
    { id: "p3", name: "Kirtan Album", color: "#7ba05b", status: "active", created_at: new Date().toISOString() },
  ];
  const demoTasks = [
    { id: uid(), project_id: "p1", title: "Collect source material", status: "done", priority: 2, start: d(-20), due: d(-12), position: 1 },
    { id: uid(), project_id: "p1", title: "Structure and outline", status: "done", priority: 2, start: d(-11), due: d(-6), position: 2 },
    { id: uid(), project_id: "p1", title: "First draft", status: "doing", priority: 3, start: d(-5), due: d(9), position: 1 },
    { id: uid(), project_id: "p1", title: "Editing, content and copy", status: "todo", priority: 2, start: d(10), due: d(20), position: 2 },
    { id: uid(), project_id: "p1", title: "Sanskrit / IAST check", status: "todo", priority: 2, start: d(21), due: d(25), position: 3 },
    { id: uid(), project_id: "p1", title: "Proofreading", status: "todo", priority: 1, start: d(26), due: d(30), position: 4 },
    { id: uid(), project_id: "p2", title: "Homepage hero design", status: "doing", priority: 3, start: d(-3), due: d(4), position: 1 },
    { id: uid(), project_id: "p2", title: "Migrate old content", status: "blocked", priority: 2, start: d(-8), due: d(-1), position: 1 },
    { id: uid(), project_id: "p3", title: "Record track 4", status: "todo", priority: 2, start: d(3), due: d(12), position: 1 },
  ].map(t => ({ notes: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...t }));
  const demoUpdates = [
    { id: uid(), project_id: "p1", author: "fluso", text: "Project created from your voice note via @fluso_pm_bot. 12 publication stages added as tasks.", created_at: new Date(Date.now() - 3600e3).toISOString() },
    { id: uid(), project_id: "p2", author: "akash", text: "Hero concept approved, moving to final design this week.", created_at: new Date(Date.now() - 7200e3).toISOString() },
  ];
  const demo = { projects: demoProjects, tasks: demoTasks, updates: demoUpdates };

  /* ---------- API ---------- */
  const DB = {
    demo: DEMO,

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
      const [p, t, u] = await Promise.all([
        sb.from("projects").select("*").order("created_at"),
        sb.from("tasks").select("*").order("position"),
        sb.from("updates").select("*").order("created_at", { ascending: false }).limit(200),
      ]);
      if (p.error) throw p.error; if (t.error) throw t.error; if (u.error) throw u.error;
      return { projects: p.data, tasks: t.data, updates: u.data };
    },

    async addProject(name) {
      const row = { name, status: "active" };
      if (DEMO) { const p = { id: uid(), color: "#e8a33d", created_at: new Date().toISOString(), ...row }; demo.projects.push(p); return p; }
      const { data, error } = await sb.from("projects").insert(row).select().single();
      if (error) throw error; return data;
    },

    async addTask(task) {
      const row = { status: "todo", priority: 2, notes: "", position: Date.now(), ...task };
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

    async addUpdate(project_id, text, author = "akash") {
      const row = { project_id, text, author };
      if (DEMO) { const u = { id: uid(), created_at: new Date().toISOString(), ...row }; demo.updates.unshift(u); return u; }
      const { data, error } = await sb.from("updates").insert(row).select().single();
      if (error) throw error; return data;
    },
  };

  window.DB = DB;
})();
