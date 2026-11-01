const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env.test') });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('node:http');

if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.toLowerCase().includes('inclusao_escolar_test')) {
  throw new Error('DATABASE_URL precisa apontar explicitamente para o banco de testes exclusivo: inclusao_escolar_test');
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  throw new Error('JWT_SECRET precisa ter pelo menos 32 caracteres para os testes.');
}

const app = require('../src/server');
const db = require('../src/db');

function resolveSchemaPath() {
  const candidates = [
    path.join(__dirname, '..', 'schema.sql'),
    path.join(__dirname, '..', 'src', 'schema.sql')
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error('schema.sql não encontrado. Verifique a localização do arquivo do banco.');
  }

  return found;
}

async function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function stopServer(server) {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
}

async function resetDatabase() {
  const schemaSql = fs.readFileSync(resolveSchemaPath(), 'utf8');
  await db.query(schemaSql);
  await db.query('TRUNCATE TABLE reports, teacher_classrooms, students, classrooms, users, schools RESTART IDENTITY CASCADE');
}

async function seedData() {
  const ownerHash = await bcrypt.hash('OwnerSenha@2026!', 12);
  const coordAHash = await bcrypt.hash('CoordASenha@2026!', 12);
  const coordBHash = await bcrypt.hash('CoordBSenha@2026!', 12);
  const teacherAHash = await bcrypt.hash('ProfASenha@2026!', 12);
  const teacherBHash = await bcrypt.hash('ProfBSenha@2026!', 12);

  await db.query(`
    INSERT INTO schools (id, name, email)
    VALUES (1, 'Escola A', 'escola-a@teste.local'),
           (2, 'Escola B', 'escola-b@teste.local')
  `);

  await db.query(`
    INSERT INTO users (id, name, email, password_hash, role, school_id, active)
    VALUES
      (1, 'Owner', 'owner@teste.local', $1, 'owner', NULL, TRUE),
      (2, 'Coord A', 'coord-a@teste.local', $2, 'coordinator', 1, TRUE),
      (3, 'Coord B', 'coord-b@teste.local', $3, 'coordinator', 2, TRUE),
      (4, 'Prof A', 'prof-a@teste.local', $4, 'teacher', 1, TRUE),
      (5, 'Prof B', 'prof-b@teste.local', $5, 'teacher', 2, TRUE)
  `, [ownerHash, coordAHash, coordBHash, teacherAHash, teacherBHash]);

  await db.query(`
    INSERT INTO classrooms (id, school_id, name)
    VALUES
      (1, 1, 'Turma 1A'),
      (2, 2, 'Turma 2B'),
      (3, 1, 'Turma 1B')
  `);

  await db.query(`
    INSERT INTO students (id, school_id, classroom_id, name)
    VALUES
      (1, 1, 1, 'Aluno A1'),
      (2, 2, 2, 'Aluno B1'),
      (3, 1, 1, 'Aluno A2'),
      (4, 2, 2, 'Aluno B2'),
      (5, 1, 3, 'Aluno A3 sem professor')
  `);

  await db.query(`
    INSERT INTO teacher_classrooms (teacher_id, classroom_id)
    VALUES
      (4, 1),
      (5, 2)
  `);

  await db.query(`
    INSERT INTO reports (id, school_id, student_id, author_id, title, content)
    VALUES
      (1, 1, 1, 4, 'Relatório A1', 'Conteúdo da escola A'),
      (2, 2, 2, 5, 'Relatório B1', 'Conteúdo da escola B')
  `);
}

async function makeRequest(server, route, options = {}) {
  const { port } = server.address();
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const text = await response.text();
  let payload = text;
  try {
    payload = JSON.parse(text);
  } catch {
    // body not json
  }

  return { status: response.status, body: payload };
}

function signToken(userId) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, { expiresIn: '8h' });
}

test.before(async () => {
  if (!process.env.DATABASE_URL || !process.env.DATABASE_URL.toLowerCase().includes('inclusao_escolar_test')) {
    throw new Error('Banco de testes não configurado corretamente.');
  }

  await resetDatabase();
  await seedData();
});

test.after(async () => {
  await db.query('TRUNCATE TABLE reports, teacher_classrooms, students, classrooms, users, schools RESTART IDENTITY CASCADE');
});

test('owner acessa /api/students retorna 403', async () => {
  const server = await startServer();
  try {
    const token = signToken(1);
    const result = await makeRequest(server, '/api/students', {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(result.status, 403);
  } finally {
    await stopServer(server);
  }
});

test('owner acessa /api/reports retorna 403', async () => {
  const server = await startServer();
  try {
    const token = signToken(1);
    const result = await makeRequest(server, '/api/reports', {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(result.status, 403);
  } finally {
    await stopServer(server);
  }
});

test('coordenador não consegue acessar dados de outra escola', async () => {
  const server = await startServer();
  try {
    const token = signToken(2);
    const result = await makeRequest(server, '/api/students', {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.body.students));
    assert.ok(result.body.students.every((student) => Number(student.school_id) === 1));
  } finally {
    await stopServer(server);
  }
});

test('professor sem vínculo com a turma não pode criar relatório', async () => {
  const server = await startServer();
  try {
    const teacherToken = signToken(4);
    const result = await makeRequest(server, '/api/reports', {
      method: 'POST',
      headers: { Authorization: `Bearer ${teacherToken}` },
      body: {
        studentId: 5,
        title: 'Relatório indevido',
        content: 'Esse professor não está vinculado à turma deste aluno.'
      }
    });

    assert.equal(result.status, 403);
  } finally {
    await stopServer(server);
  }
});

test('requisição sem token retorna 401', async () => {
  const server = await startServer();
  try {
    const result = await makeRequest(server, '/api/me');
    assert.equal(result.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('requisição com token inválido retorna 401', async () => {
  const server = await startServer();
  try {
    const result = await makeRequest(server, '/api/me', {
      headers: { Authorization: 'Bearer token-invalido' }
    });

    assert.equal(result.status, 401);
  } finally {
    await stopServer(server);
  }
});

test('usuário autorizado acessa os próprios dados', async () => {
  const server = await startServer();
  try {
    const token = signToken(4);
    const result = await makeRequest(server, '/api/me', {
      headers: { Authorization: `Bearer ${token}` }
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.user.role, 'teacher');
    assert.equal(Number(result.body.user.id), 4);
  } finally {
    await stopServer(server);
  }
});
