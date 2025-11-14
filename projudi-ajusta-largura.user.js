// ==UserScript==
// @name         Projudi - Ajusta Largura da Página
// @namespace    projudi-ajusta-largura.user.js
// @version      1.0
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Ajusta a largura da página, pra melhor aproveitamento de tela.
// @author       lourencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv/f45b5403f43c37c0daf7731bebac4af3/raw/projudi-anotacoes-locais.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv/f45b5403f43c37c0daf7731bebac4af3/raw/projudi-anotacoes-locais.user.js
// @match        https://projudi.tjgo.jus.br/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ================= CONFIG =================
    const AUTO_HIDE_HEADER = false;        // esconder cabeçalho ao entrar no iframe
    const HOTKEY_TOGGLE_HEADER = false;    // Ctrl+Alt+C alterna cabeçalho
    // ==========================================

    function isTopWindow() {
        return window.top === window.self;
    }

    // --------- CSS só do HEADER (topo, fora do iframe) ----------
    function injectTopHeaderCSS() {
        if (document.getElementById('projudi-top-header-style')) return;

        const css = `
            /* Cabecalho ocupando toda a largura */
            #Cabecalho {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                background-color: #004b8d !important;  /* azul mais uniforme */
                box-shadow: 0 2px 4px rgba(0,0,0,.15);
            }

            /* Container interno do logo + menu */
            #pgn_cabecalho {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 4px 20px 6px 20px;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: space-between;
            }

            /* Logo TJ e título */
            #img_logotj {
                float: none !important;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            #img_logotj h1 {
                margin: 0;
                font-size: 18px;
                font-weight: 600;
                color: #ffffff;
            }

            #img_logotj #servidor {
                margin-left: 8px;
                font-size: 11px;
                color: #e0f2fe;
            }

            /* Bloco do menu da direita */
            #pgn_cabecalho > div[style*="float: right"] {
                float: none !important;
            }

            #cssmenu {
                margin: 0 !important;
            }

            #cssmenu ul {
                margin: 0;
            }

            /* Ícones e links do topo em branco */
            #cssmenu a,
            #cssmenu i {
                color: #ffffff !important;
            }

            #cssmenu li:hover > a,
            #cssmenu li:hover > i {
                color: #facc15 !important; /* amarelinho no hover */
            }

            /* Faixa cinza logo abaixo do header (separador) */
            body > div[style*="height:28px"][style*="background-color:#ccc"] {
                background-color: #e5e7eb !important;
                border-bottom: 1px solid #cbd5e1;
            }
        `;

        const style = document.createElement('style');
        style.id = 'projudi-top-header-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    // ---------------- TOPO (página que contém o iframe) ----------------
    function ajustarAlturaIframe() {
        const iframe = document.getElementById('Principal');
        if (!iframe) return;

        const cabecalho = document.getElementById('Cabecalho');
        const barraCinza = Array.from(document.body.children)
        .find(d =>
              d !== iframe &&
              d.style &&
              d.style.height === '28px' &&
              d.style.backgroundColor === '#ccc'
             );

        let offsetTop = 0;
        if (cabecalho && cabecalho.offsetHeight) offsetTop += cabecalho.offsetHeight;
        if (barraCinza && barraCinza.offsetHeight) offsetTop += barraCinza.offsetHeight;

        const h = window.innerHeight - offsetTop;
        if (h > 200) {
            iframe.style.height = h + 'px';
        }
    }

    let headerHidden = false;
    function setHeaderHidden(hidden) {
        const cab = document.getElementById('Cabecalho');
        if (!cab) return;
        headerHidden = hidden;
        cab.style.transition = 'transform .25s ease';
        cab.style.willChange = 'transform';
        cab.style.transform = hidden ? 'translateY(-100%)' : 'translateY(0)';
        setTimeout(ajustarAlturaIframe, 260);
    }
    function toggleHeader() {
        setHeaderHidden(!headerHidden);
    }

    function setupHeaderAutoHide() {
        if (!AUTO_HIDE_HEADER) return;
        const iframe = document.getElementById('Principal');
        if (!iframe) return;

        iframe.addEventListener('mouseenter', () => setHeaderHidden(true));
        document.addEventListener('mousemove', (e) => {
            if (e.clientY < 80) setHeaderHidden(false);
        });
    }

    function setupHotkeyToggle() {
        if (!HOTKEY_TOGGLE_HEADER) return;
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.altKey && (e.key === 'c' || e.key === 'C')) {
                e.preventDefault();
                toggleHeader();
            }
        });
    }

    // ----------- INJETAR CSS DENTRO DO IFRAME (miolo) -----------
    function injectCSSInIframe() {
        const iframe = document.getElementById('Principal');
        if (!iframe || !iframe.contentDocument) return;
        const doc = iframe.contentDocument;

        if (doc.getElementById('projudi-ajuste-largura')) return;

        const css = `
            html, body {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
                overflow-x: auto !important;
            }

            body > div,
            body > table,
            body > form {
                max-width: 100% !important;
                width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }

            #divCorpo,
            #Corpo,
            #conteudo,
            #conteudoPrincipal,
            #pgn_corpo,
            .Tela,
            .Corpo,
            .conteudo {
                max-width: 100% !important;
                width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }

            table,
            .Tabela,
            .divTabela,
            .divTabela table {
                max-width: 100% !important;
                width: 100% !important;
            }
        `;

        const style = doc.createElement('style');
        style.id = 'projudi-ajuste-largura';
        style.textContent = css;
        doc.head.appendChild(style);
    }

    function registrarOnLoadNoIframe() {
        const iframe = document.getElementById('Principal');
        if (!iframe) return;

        iframe.addEventListener('load', () => {
            setTimeout(() => {
                injectCSSInIframe();
            }, 200);
        });

        setTimeout(() => {
            injectCSSInIframe();
        }, 600);
    }

    // ---------------- INIT TOP / FRAME ----------------
    function initTop() {
        injectTopHeaderCSS();
        ajustarAlturaIframe();
        window.addEventListener('resize', ajustarAlturaIframe);
        setupHeaderAutoHide();
        setupHotkeyToggle();
        registrarOnLoadNoIframe();
    }

    function initInsideFrame() {
        if (document.getElementById('projudi-ajuste-largura-interno')) return;
        const css = `
            html, body {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 0 !important;
            }
            body > div,
            body > table,
            body > form {
                max-width: 100% !important;
                width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
            }
        `;
        const style = document.createElement('style');
        style.id = 'projudi-ajuste-largura-interno';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function init() {
        if (isTopWindow()) {
            initTop();
        } else {
            initInsideFrame();
        }
    }

    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(init, 300);
    } else {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 300));
    }
})();