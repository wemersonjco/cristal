# Encomendas da Portaria

Sistema de controle de recebimento e entrega de encomendas para portaria de condomínio.
App estático (HTML + JavaScript, sem etapa de build) com banco e login no Supabase.

## Estrutura

```
index.html            página única do app
css/style.css         estilos (claro e escuro)
js/config.js          URL e chave do Supabase (vazio = modo demonstração)
js/db.js              camada de dados: backend Supabase e backend local de demonstração
js/app.js             telas e regras
supabase/migrations/  esquema do banco, políticas de segurança (RLS) e funções
manifest.json, sw.js  instalação no tablet (PWA) e abertura offline da casca do app
```

## Rodar no computador

Os módulos JavaScript precisam de um servidor local (não funciona abrindo o arquivo direto).
Dentro da pasta:

```
python -m http.server 8080
```

Abra http://localhost:8080. Com `js/config.js` vazio, o app abre em modo demonstração
(160 apartamentos de exemplo, dados salvos só no navegador).

## Supabase (já ligado)

Projeto na organização gratuita **PORTARIA CRISTAL**:
`https://lavdmqnagigrwgcpoape.supabase.co` (região us-east-1). O esquema (migrações 0001, 0002 e 0003)
já está aplicado, com segurança por linha (RLS) e a checagem de segurança do Supabase sem alertas.
`js/config.js` já aponta para ele com a chave pública (anon).

O que falta fazer no painel do Supabase:

1. Authentication, Users, **Add user**: crie o primeiro usuário (e-mail e senha). Ele vira **síndico** ativo.
   Marque "Auto Confirm User" para ele poder entrar sem confirmar e-mail.
2. Authentication, Sign In / Providers: desligue **Allow new users to sign up**.
   Novos usuários são criados só por você no painel; mesmo que o cadastro público seja ligado
   por engano, quem não for ativado pelo síndico não enxerga nenhum dado.
3. Para cada porteiro: crie o usuário no painel e depois, no app, em Ajustes, Equipe, ative.
4. Cadastre ou importe os moradores (aba Moradores).

Para voltar ao modo demonstração (dados de exemplo, sem login), esvazie as duas linhas de `js/config.js`.

## Perfis

| | Porteiro | Síndico |
|---|---|---|
| Registrar, entregar, avisar, etiqueta | sim | sim |
| Cadastrar morador, importar lista | sim | sim |
| Excluir morador, desfazer entrega | desfazer sim, excluir não | sim |
| Ajustes, texto do aviso, equipe | não | sim |

## Publicar de graça

Qualquer hospedagem de site estático serve (Cloudflare Pages, Netlify, GitHub Pages).
Publique a pasta inteira. No tablet da portaria, abra o endereço no Chrome e use
"Instalar app" ou "Adicionar à tela inicial".

## Limites do plano gratuito do Supabase (conferir antes de vender)

- Projetos gratuitos pausam após 1 semana sem atividade. Numa portaria com uso diário isso
  não acontece, mas um prédio que ficar sem uso por uma semana precisa reativar o projeto.
- Não há backup automático no plano gratuito. Use o botão de exportar CSV no Relatório
  periodicamente até migrar para o plano Pro.
- 500 MB de banco: sobra para milhares de encomendas por mês.

## Próximos passos

- Aviso automático por WhatsApp (API oficial) e leitura da etiqueta por IA (Opções 1 e 2 da proposta).
- Leitura do QR pela câmera do tablet.
- Aviso por e-mail ou push como alternativa gratuita ao WhatsApp.

## Blocos, várias encomendas e controle de aviso

- Cada apartamento é identificado por **bloco + número** (ex.: A1-13). Os blocos ficam em Ajustes (síndico), separados por vírgula.
- Importação de moradores: `nome;bloco;apto;telefone`, uma linha por morador.
- Cada volume tem o seu próprio código (e etiqueta). No registro, o campo "Volumes" cria vários de uma vez.
- Em Pendentes, as encomendas aparecem agrupadas por apartamento. O aviso do WhatsApp lista todos os códigos numa só mensagem, e "Entregar todas" permite marcar quais estão sendo retiradas.
- Aviso: o sistema não consegue saber se o WhatsApp foi mesmo enviado. Depois de abrir o WhatsApp, o porteiro confirma "Sim, enviei" e fica registrado quando, por quem e por qual canal (WhatsApp, interfone, pessoalmente...).
