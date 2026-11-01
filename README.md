[create-owner.js](https://github.com/user-attachments/files/34248456/create-owner.js)

require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../src/db');

(async () => {
  try {
    const name = (process.env.OWNER_NAME || '').trim();
    const email = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
    const password = process.env.OWNER_PASSWORD || '';
    if (!name || !email.includes('@') || password.length < 12) {
      throw new Error('Preencha OWNER_NAME, OWNER_EMAIL e OWNER_PASSWORD (mínimo de 12 caracteres) no .env.');
    }
    const exists = await db.query("SELECT id FROM users WHERE role = 'owner' LIMIT 1");
    if (exists.rowCount) throw new Error('Já existe uma conta de proprietário. O script não cria outra.');
    const hash = await bcrypt.hash(password, 12);
    const r = await db.query(
      "INSERT INTO users (name, email, password_hash, role, school_id) VALUES ($1, $2, $3, 'owner', NULL) RETURNING id, name, email, role",
      [name, email, hash]
    );
    console.log('Conta de proprietário criada:', r.rows[0]);
    console.log('Guarde a senha definida no .env em local seguro. Ela não é exibida nem armazenada em texto puro no banco.');
  } catch (e) {
    console.error('Não foi possível criar o proprietário:', e.message);
    process.exitCode = 1;
  } finally {
    await db.pool.end();
  }
})();
