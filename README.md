# Inclusão Escolar — backend inicial

Este pacote inclui um **frontend novo e simplificado conectado à API** (`public/index.html`) e um backend Node.js/PostgreSQL. Ele não preserva ainda todas as telas e recursos avançados do HTML original. O HTML original foi mantido fora deste pacote como referência; não o use como sistema multiusuário seguro porque usa `localStorage`.

## Requisitos
- Node.js LTS
- PostgreSQL instalado e iniciado
- VS Code

## 1. Configurar
1. Extraia o ZIP em uma pasta, por exemplo `C:\\inclusao-escolar`.
2. Abra essa pasta no VS Code.
3. Copie `.env.example` para `.env`.
4. No `.env`, configure `DATABASE_URL`, `JWT_SECRET`, `OWNER_NAME`, `OWNER_EMAIL` e `OWNER_PASSWORD`. Use uma senha forte com pelo menos 12 caracteres. Não envie nem publique o `.env`.
5. Crie no PostgreSQL um banco chamado `inclusao_escolar` (ou altere o nome na `DATABASE_URL`).

Exemplo de comando SQL no pgAdmin:
```sql
CREATE DATABASE inclusao_escolar;
```

## 2. Instalar e inicializar
No terminal do VS Code, dentro da pasta do projeto:
```bash
npm install
npm run db:init
npm run owner:create
npm run dev
```

Verifique `http://localhost:3333/api/health`. A resposta esperada é `{"ok":true,"database":"connected"}`.

## 3. Papéis
- `owner`: cadastra escolas e coordenadores.
- `coordinator`: cadastra professores, turmas, alunos e relatórios da própria escola.
- `teacher`: consulta alunos/turmas autorizados e cria/consulta relatórios autorizados.

O professor precisa ser associado às turmas usando a tabela `teacher_classrooms`. Ainda falta uma rota de gestão dessa associação e a integração completa da interface para atribuir professores às turmas.

## 4. Interface integrada\nDepois de iniciar `npm run dev`, abra `http://localhost:3333`. A interface integrada permite login, cadastro de escolas, coordenadores, professores, turmas, alunos e relatórios conforme o perfil. O vínculo professor-turma está disponível pela API, mas ainda não há uma tela para administrá-lo; por isso, antes de testar a conta de professor, associe-o a uma turma via API ou peça para adicionarmos essa tela.\n\n## 5. Rotas incluídas
- `POST /api/auth/login` — login `{ "email": "...", "password": "..." }`
- `GET /api/me` — usuário autenticado
- `POST /api/schools` — proprietário; `{ "name": "...", "email": "..." }`
- `GET /api/schools` — proprietário vê todas; demais veem a própria escola
- `POST /api/users` — proprietário cria coordenador `{ "name", "email", "password", "role": "coordinator", "schoolId": 1 }`; coordenador cria professor `{ "name", "email", "password", "role": "teacher" }`
- `GET /api/users` — proprietário/coordenador veem usuários permitidos
- `POST /api/classrooms` — coordenador; `{ "name": "Turma A" }`
- `GET /api/classrooms`
- `POST /api/students` — coordenador; `{ "name": "Nome do aluno", "classroomId": 1 }`
- `GET /api/students`
- `POST /api/reports` — coordenador/professor; `{ "studentId": 1, "title": "...", "content": "..." }`
- `GET /api/reports`

Para as rotas autenticadas, envie o cabeçalho:
`Authorization: Bearer SEU_TOKEN`

## Importante antes de usar com escolas reais
- O HTML original usa `localStorage`; não o considere um sistema seguro com vários usuários até a interface ser ligada a este backend e a persistência local de dados sensíveis ser removida.
- Este pacote é uma fundação de desenvolvimento e precisa de testes, configuração de HTTPS, política de backup, recuperação de senha, controle de tentativas de login, logs adequados e revisão de segurança antes de produção.
- Dados de alunos, especialmente informações de inclusão/saúde, podem ser sensíveis. Use dados fictícios durante testes e valide requisitos da LGPD com profissional responsável.
- Nunca coloque senhas reais no código-fonte, em mensagens públicas ou em repositórios.
