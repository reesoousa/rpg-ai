import { copyFile } from 'node:fs/promises'

/**
 * GitHub Pages nao tem rewrite de servidor: uma rota profunda como
 * /rpg-ai/jogar responderia 404. Servindo o index.html tambem como 404.html,
 * o Pages devolve o app e o React Router resolve a rota no cliente.
 */
await copyFile('dist/index.html', 'dist/404.html')
console.log('spa-fallback: dist/404.html criado')
