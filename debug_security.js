const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const app = require('./src/server');
const db = require('./src/db');

(async () => {
  process.env.DATABASE_URL = 'postgresql://postgres@localhost:55432/inclusao_escolar_test';
  process.env.JWT_SECRET = 'seguranca_testes_inclusao_escolar_2026_32chars';
  const schema = fs.readFileSync('./schema.sql', 'utf8');
  await db.query(schema);
  await db.query('TRUNCATE TABLE reports, teacher_classrooms, students, classrooms, users, schools RESTART IDENTITY CASCADE');
  const ownerHash = await bcrypt.hash('OwnerSenha@2026!', 12);
  const coordAHash = await bcrypt.hash('CoordASenha@2026!', 12);
  const coordBHash = await bcrypt.hash('CoordBSenha@2026!', 12);
  const teacherAHash = await bcrypt.hash('ProfASenha@2026!', 12);
  const teacherBHash = await bcrypt.hash('ProfBSenha@2026!', 12);
  await db.query(`INSERT INTO schools (id, name, email) VALUES (1, 'Escola A', 'escola-a@teste.local'), (2, 'Escola B', 'escola-b@teste.local')`);
  await db.query(`INSERT INTO users (id, name, email, password_hash, role, school_id, active) VALUES (1, 'Owner', 'owner@teste.local', $1, 'owner', NULL, TRUE),(2,'Coord A','coord-a@teste.local',$2,'coordinator',1,TRUE),(3,'Coord B','coord-b@teste.local',$3,'coordinator',2,TRUE),(4,'Prof A','prof-a@teste.local',$4,'teacher',1,TRUE),(5,'Prof B','prof-b@teste.local',$5,'teacher',2,TRUE)`, [ownerHash, coordAHash, coordBHash, teacherAHash, teacherBHash]);
  await db.query(`INSERT INTO classrooms (id, school_id, name) VALUES (1,1,'Turma 1A'), (2,2,'Turma 2B'), (3,1,'Turma 1B')`);
  await db.query(`INSERT INTO students (id, school_id, classroom_id, name) VALUES (1,1,1,'Aluno A1'), (2,2,2,'Aluno B1'), (3,1,1,'Aluno A2'), (4,2,2,'Aluno B2'), (5,1,3,'Aluno A3 sem professor')`);
  await db.query(`INSERT INTO teacher_classrooms (teacher_id, classroom_id) VALUES (4,1),(5,2)`);

  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const token = jwt.sign({ sub: '2' }, process.env.JWT_SECRET, { expiresIn: '8h' });
  const response = await fetch(`http://127.0.0.1:${port}/api/students`, { headers: { Authorization: `Bearer ${token}` } });
  console.log('status', response.status);
  console.log(await response.text());
  server.close();
  await db.pool.end();
})();
