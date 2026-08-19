/**
 * Recarrega a pagina quando um service worker novo toma o controle.
 *
 * Sem isto, o comportamento padrao do Workbox e: servir o cache antigo nesta
 * visita, baixar a versao nova em segundo plano e aplicar so no carregamento
 * SEGUINTE. Em um app que muda toda hora, isso significa abrir o site depois de
 * um deploy e ver a versao anterior — sem nenhum aviso de que ha algo mais novo.
 *
 * A trava `recarregando` existe porque `controllerchange` pode disparar mais de
 * uma vez; sem ela o reload viraria laco.
 */
export function recarregarQuandoAtualizar() {
  if (!('serviceWorker' in navigator)) return

  let recarregando = false

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recarregando) return
    // Primeira instalacao nao tinha controller: aqui nao ha versao velha na
    // tela, e recarregar seria um piscar inutil.
    if (!navigator.serviceWorker.controller) return
    recarregando = true
    window.location.reload()
  })
}
