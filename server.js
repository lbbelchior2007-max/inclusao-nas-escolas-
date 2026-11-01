require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { auth, allow } = require('./middleware');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres e ser exclusivo.');
}

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch {
    res.status(503).json({ ok: false, database: 'disconnected' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!email || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });

  const result = await db.query(
    'SELECT id, name, email, password_hash, role, school_id, active FROM users WHERE email = $1',
    [email]
  );
  const user = result.rows[0];
  if (!user || !user.active || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  const token = jwt.sign({ sub: String(user.id) }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, schoolId: user.school_id }
  });
});

app.get('/api/me', auth, (req, res) => res.json({ user: req.user }));

// Somente proprietário pode cadastrar escolas.
app.post('/api/schools', auth, allow('owner'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase() || null;
  if (!name) return res.status(400).json({ error: 'Informe o nome da escola.' });
  const result = await db.query(
    'INSERT INTO schools (name, email) VALUES ($1, $2) RETURNING id, name, email, status, created_at',
    [name, email]
  );
  res.status(201).json({ school: result.rows[0] });
});

app.get('/api/schools', auth, async (req, res) => {
  if (req.user.role === 'owner') {
    const r = await db.query('SELECT id, name, email, status, created_at FROM schools ORDER BY name');
    return res.json({ schools: r.rows });
  }
  const r = await db.query('SELECT id, name, email, status FROM schools WHERE id = $1', [req.user.school_id]);
  return res.json({ schools: r.rows });
});

// Proprietário cria coordenador; coordenador só pode criar professores da própria escola.
app.post('/api/users', auth, async (req, res) => {
  const role = String(req.body.role || '');
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  let schoolId = Number(req.body.schoolId);

  if (!name || !email || !email.includes('@')) return res.status(400).json({ error: 'Informe nome e e-mail válidos.' });
  if (password.length < 12) return res.status(400).json({ error: 'A senha inicial deve ter pelo menos 12 caracteres.' });

  if (req.user.role === 'owner' && role === 'coordinator') {
    if (!Number.isInteger(schoolId) || schoolId < 1) return res.status(400).json({ error: 'Informe a escola do coordenador.' });
    const school = await db.query('SELECT id FROM schools WHERE id = $1', [schoolId]);
    if (!school.rowCount) return res.status(404).json({ error: 'Escola não encontrada.' });
  } else if (req.user.role === 'coordinator' && role === 'teacher') {
    schoolId = req.user.school_id;
  } else {
    return res.status(403).json({ error: 'Proprietário cria coordenadores; coordenador cria professores da própria escola.' });
  }

  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await db.query(
      'INSERT INTO users (name, email, password_hash, role, school_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, role, school_id, active',
      [name, email, hash, role, schoolId]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
    throw e;
  }
});

// Coordenador vê os professores da própria escola. Proprietário pode consultar todos.
app.get('/api/users', auth, async (req, res) => {
  if (req.user.role === 'teacher') return res.status(403).json({ error: 'Professores não podem administrar usuários.' });
  const result = req.user.role === 'owner'
    ? await db.query("SELECT id, name, email, role, school_id, active FROM users WHERE role <> 'owner' ORDER BY school_id, role, name")
    : await db.query("SELECT id, name, email, role, school_id, active FROM users WHERE school_id = $1 AND role = 'teacher' ORDER BY name", [req.user.school_id]);
  res.json({ users: result.rows });
});

// Base inicial de turmas e alunos, sempre limitada à escola no servidor.
app.post('/api/classrooms', auth, allow('coordinator'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe o nome da turma.' });
  const r = await db.query(
    'INSERT INTO classrooms (school_id, name) VALUES ($1, $2) RETURNING id, school_id, name',
    [req.user.school_id, name]
  );
  res.status(201).json({ classroom: r.rows[0] });
});

app.get('/api/classrooms', auth, async (req, res) => {
  if (req.user.role === 'owner') {
    const r = await db.query('SELECT id, school_id, name FROM classrooms ORDER BY school_id, name');
    return res.json({ classrooms: r.rows });
  }
  if (req.user.role === 'coordinator') {
    const r = await db.query('SELECT id, school_id, name FROM classrooms WHERE school_id = $1 ORDER BY name', [req.user.school_id]);
    return res.json({ classrooms: r.rows });
  }
  const r = await db.query(
    'SELECT c.id, c.school_id, c.name FROM classrooms c JOIN teacher_classrooms tc ON tc.classroom_id = c.id WHERE tc.teacher_id = $1 AND c.school_id = $2 ORDER BY c.name',
    [req.user.id, req.user.school_id]
  );
  res.json({ classrooms: r.rows });
});

app.post('/api/students', auth, allow('coordinator'), async (req, res) => {
  const name = String(req.body.name || '').trim();
  const classroomId = req.body.classroomId ? Number(req.body.classroomId) : null;
  if (!name) return res.status(400).json({ error: 'Informe o nome do aluno.' });
  if (classroomId) {
    const c = await db.query('SELECT id FROM classrooms WHERE id = $1 AND school_id = $2', [classroomId, req.user.school_id]);
    if (!c.rowCount) return res.status(404).json({ error: 'Turma não encontrada nesta escola.' });
  }
  const r = await db.query(
    'INSERT INTO students (school_id, classroom_id, name) VALUES ($1, $2, $3) RETURNING id, school_id, classroom_id, name',
    [req.user.school_id, classroomId, name]
  );
  res.status(201).json({ student: r.rows[0] });
});

app.get('/api/students', auth, async (req, res) => {
  if (req.user.role === 'owner') {
    return res.status(403).json({ error: 'O proprietário não pode consultar dados internos de alunos.' });
  }
  if (req.user.role === 'coordinator') {
    const r = await db.query('SELECT id, school_id, classroom_id, name FROM students WHERE school_id = $1 ORDER BY name', [req.user.school_id]);
    return res.json({ students: r.rows });
  }
  const r = await db.query(
    'SELECT DISTINCT s.id, s.school_id, s.classroom_id, s.name FROM students s JOIN teacher_classrooms tc ON tc.classroom_id = s.classroom_id WHERE tc.teacher_id = $1 AND s.school_id = $2 ORDER BY s.name',
    [req.user.id, req.user.school_id]
  );
  res.json({ students: r.rows });
});

// Professor e coordenador podem criar relatórios, mas somente dentro da própria escola.
// Professor só pode criar para aluno de turma vinculada a ele.
app.post('/api/reports', auth, allow('coordinator', 'teacher'), async (req, res) => {
  const studentId = Number(req.body.studentId);
  const title = String(req.body.title || '').trim();
  const content = String(req.body.content || '').trim();
  if (!Number.isInteger(studentId) || studentId < 1 || !title || !content) {
    return res.status(400).json({ error: 'Informe aluno, título e conteúdo do relatório.' });
  }
  const student = await db.query(
    'SELECT id, classroom_id FROM students WHERE id = $1 AND school_id = $2',
    [studentId, req.user.school_id]
  );
  if (!student.rowCount) return res.status(404).json({ error: 'Aluno não encontrado nesta escola.' });
  if (req.user.role === 'teacher') {
    const assigned = await db.query(
      'SELECT 1 FROM teacher_classrooms WHERE teacher_id = $1 AND classroom_id = $2',
      [req.user.id, student.rows[0].classroom_id]
    );
    if (!assigned.rowCount) return res.status(403).json({ error: 'Você não está vinculado à turma deste aluno.' });
  }
  const r = await db.query(
    'INSERT INTO reports (school_id, student_id, author_id, title, content) VALUES ($1, $2, $3, $4, $5) RETURNING id, student_id, author_id, title, content, created_at',
    [req.user.school_id, studentId, req.user.id, title, content]
  );
  res.status(201).json({ report: r.rows[0] });
});

app.get('/api/reports', auth, allow('coordinator', 'teacher'), async (req, res) => {
  if (req.user.role === 'owner') {
    return res.status(403).json({ error: 'O proprietário não pode consultar relatórios de alunos.' });
  }
  const params = [req.user.school_id];
  let sql = 'SELECT r.id, r.student_id, s.name AS student_name, r.author_id, u.name AS author_name, r.title, r.content, r.created_at FROM reports r JOIN students s ON s.id = r.student_id JOIN users u ON u.id = r.author_id WHERE r.school_id = $1';
  if (req.user.role === 'teacher') {
    sql += ' AND EXISTS (SELECT 1 FROM teacher_classrooms tc WHERE tc.teacher_id = $2 AND tc.classroom_id = s.classroom_id)';
    params.push(req.user.id);
  }
  sql += ' ORDER BY r.created_at DESC';
  const r = await db.query(sql, params);
  res.json({ reports: r.rows });
});

// Vincular professor a uma turma: somente coordenador da própria escola.
app.get('/api/classrooms/:id/teachers', auth, allow('coordinator'), async (req, res) => {
  const classroomId = Number(req.params.id);
  if (!Number.isInteger(classroomId) || classroomId < 1) {
    return res.status(400).json({ error: 'Informe uma turma válida.' });
  }

  const classroom = await db.query('SELECT id FROM classrooms WHERE id = $1 AND school_id = $2', [classroomId, req.user.school_id]);
  if (!classroom.rowCount) {
    return res.status(404).json({ error: 'Turma não encontrada nesta escola.' });
  }

  const result = await db.query(
    'SELECT u.id, u.name, u.email, u.school_id FROM users u JOIN teacher_classrooms tc ON tc.teacher_id = u.id WHERE tc.classroom_id = $1 AND u.school_id = $2 ORDER BY u.name',
    [classroomId, req.user.school_id]
  );

  const teacherIds = result.rows.map((teacher) => teacher.id);
  res.json({ teacherIds, teachers: result.rows });
});

app.post('/api/classrooms/:id/teachers', auth, allow('coordinator'), async (req, res) => {
  const classroomId = Number(req.params.id);
  const teacherId = Number(req.body.teacherId);
  if (!Number.isInteger(classroomId) || !Number.isInteger(teacherId)) {
    return res.status(400).json({ error: 'Informe turma e professor válidos.' });
  }
  const classroom = await db.query('SELECT id FROM classrooms WHERE id = $1 AND school_id = $2', [classroomId, req.user.school_id]);
  const teacher = await db.query("SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher' AND active = TRUE", [teacherId, req.user.school_id]);
  if (!classroom.rowCount || !teacher.rowCount) return res.status(404).json({ error: 'Turma ou professor não encontrado nesta escola.' });
  await db.query('INSERT INTO teacher_classrooms (teacher_id, classroom_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [teacherId, classroomId]);
  res.status(201).json({ ok: true });
});

app.delete('/api/classrooms/:id/teachers/:teacherId', auth, allow('coordinator'), async (req, res) => {
  const classroomId = Number(req.params.id);
  const teacherId = Number(req.params.teacherId);
  const classroom = await db.query('SELECT id FROM classrooms WHERE id = $1 AND school_id = $2', [classroomId, req.user.school_id]);
  const teacher = await db.query("SELECT id FROM users WHERE id = $1 AND school_id = $2 AND role = 'teacher'", [teacherId, req.user.school_id]);
  if (!classroom.rowCount || !teacher.rowCount) return res.status(404).json({ error: 'Turma ou professor não encontrado nesta escola.' });
  await db.query('DELETE FROM teacher_classrooms WHERE teacher_id = $1 AND classroom_id = $2', [teacherId, classroomId]);
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Consulte o log do servidor.' });
});

const port = Number(process.env.PORT || 3333);
if (require.main === module) {
  app.listen(port, () => console.log(`Inclusão Escolar API disponível em http://localhost:${port}`));
}

module.exports = app;
