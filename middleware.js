const jwt = require('jsonwebtoken');
const db = require('./db');

async function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Faça login para continuar.' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const result = await db.query(
      'SELECT id, name, email, role, school_id, active FROM users WHERE id = $1',
      [payload.sub]
    );
    const user = result.rows[0];
    if (!user || !user.active) return res.status(401).json({ error: 'Conta inexistente ou desativada.' });
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida ou expirada.' });
  }
}

function allow(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Você não tem permissão para esta ação.' });
    }
    next();
  };
}

module.exports = { auth, allow };
