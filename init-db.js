require('dotenv').config();
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

(async () => {
  try {
    const sql = fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf8');
    await db.query(sql);
    console.log('Tabelas criadas/verificadas com sucesso.');
  } catch (e) {
    console.error('Falha ao inicializar banco:', e.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
