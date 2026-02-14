// ==UserScript==
// @name         Ajusta a Largura da Página
// @namespace    projudi-ajusta-largura.user.js
// @version      1.2
// @icon         https://img.icons8.com/ios-filled/100/scales--v1.png
// @description  Ajusta a largura da página, pra melhor aproveitamento de tela.
// @author       lourencosv (GPT)
// @license      CC BY-NC 4.0
// @updateURL    https://gist.githubusercontent.com/lourencosv/f45b5403f43c37c0daf7731bebac4af3/raw/projudi-anotacoes-locais.user.js
// @downloadURL  https://gist.githubusercontent.com/lourencosv/f45b5403f43c37c0daf7731bebac4af3/raw/projudi-anotacoes-locais.user.js
// @match        *://projudi.tjgo.jus.br/*
// @run-at       document-end
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==

(function () {
    "use strict";

    const STORAGE_KEY = "projudi-wide-settings-v1";
    const DEFAULT_SETTINGS = {
        autoHideHeader: false,
        enableIframeAutoHeight: true,
        contentWidthPercent: 100
    };

    const OPTOUT_ATTR = "data-projudi-wide-optout";
    let settings = loadSettings();
    let iframeLoadBound = false;

    function isTopWindow() {
        return window.top === window.self;
    }

    function loadSettings() {
        try {
            if (typeof GM_getValue === "function") {
                const raw = GM_getValue(STORAGE_KEY, "");
                if (!raw) return { ...DEFAULT_SETTINGS };
                return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
            }
        } catch (_) {}
        return { ...DEFAULT_SETTINGS };
    }

    function saveSettings(next) {
        settings = { ...DEFAULT_SETTINGS, ...next };
        settings.contentWidthPercent = sanitizeWidthPercent(settings.contentWidthPercent);
        if (typeof GM_setValue === "function") {
            GM_setValue(STORAGE_KEY, JSON.stringify(settings));
        }
    }

    function sanitizeWidthPercent(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return DEFAULT_SETTINGS.contentWidthPercent;
        return Math.max(60, Math.min(100, Math.round(n)));
    }

    function registerMenu() {
        if (!isTopWindow()) return;
        if (typeof GM_registerMenuCommand === "function") {
            GM_registerMenuCommand("Abrir Painel", openSettingsPanel);
        }
    }

    function openSettingsPanel() {
        if (!isTopWindow()) return;
        if (document.getElementById("projudi-wide-panel-overlay")) return;

        const previousBodyOverflow = document.body.style.overflow;
        const overlay = document.createElement("div");
        overlay.id = "projudi-wide-panel-overlay";
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(11, 18, 32, .50); z-index: 2147483647;
            backdrop-filter: blur(4px);
            -webkit-backdrop-filter: blur(4px);
            display: flex; align-items: center; justify-content: center;
            padding: 18px;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            width: 480px; max-width: calc(100vw - 24px); background: #ffffff; color: #0f172a;
            border-radius: 14px; box-shadow: 0 24px 70px rgba(2, 6, 23, .30);
            border: 1px solid #dbe3ef;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
            overflow: hidden;
            transform: translateY(6px) scale(.985);
            opacity: .96;
            transition: transform .16s ease, opacity .16s ease;
        `;

        const scopedStyle = document.createElement("style");
        scopedStyle.textContent = `
            #projudi-wide-panel-overlay #pj-reset,
            #projudi-wide-panel-overlay #pj-cancel,
            #projudi-wide-panel-overlay #pj-save,
            #projudi-wide-panel-overlay #pj-close {
                text-indent: 0 !important;
                letter-spacing: normal !important;
                font-size: 14px !important;
                font-weight: 500 !important;
                text-transform: none !important;
                line-height: 1.2 !important;
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif !important;
                white-space: nowrap !important;
            }

            #projudi-wide-panel-overlay #pj-reset,
            #projudi-wide-panel-overlay #pj-cancel {
                color: #1e293b !important;
                background: #ffffff !important;
                border: 1px solid #cbd5e1 !important;
            }

            #projudi-wide-panel-overlay #pj-save {
                color: #ffffff !important;
                background: #0f3e75 !important;
                border: 1px solid #0f3e75 !important;
            }

            #projudi-wide-panel-overlay #pj-close {
                color: #ffffff !important;
            }
        `;

        panel.innerHTML = `
            <div style="padding:14px 16px; background:linear-gradient(135deg,#0f3e75,#1f5ca4); color:#fff;">
                <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
                    <div>
                        <div style="font-size:16px; font-weight:700; line-height:1.2;">Ajuste da Página</div>
                        <div style="font-size:12px; opacity:.9; margin-top:2px;">Configurações visuais do Projudi</div>
                    </div>
                    <button id="pj-close" style="border:0; background:rgba(255,255,255,.2); color:#fff; width:28px; height:28px; border-radius:999px; cursor:pointer; font-size:16px; line-height:1;">×</button>
                </div>
            </div>
            <div style="padding:16px;">
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #e5e7eb; border-radius:10px; margin-bottom:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ocultar cabeçalho automaticamente</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Esconde o topo ao passar o mouse na área do processo.</div>
                    </div>
                    <input type="checkbox" id="pj-auto-hide" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; padding:12px; border:1px solid #e5e7eb; border-radius:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Ajuste automático da altura</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Calcula a altura ideal do iframe para usar melhor a tela.</div>
                    </div>
                    <input type="checkbox" id="pj-iframe-height" style="width:18px; height:18px; margin-top:2px;">
                </label>
                <label style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px; border:1px solid #e5e7eb; border-radius:10px; margin-top:10px;">
                    <div>
                        <div style="font-weight:600; color:#0f172a;">Largura da página (%)</div>
                        <div style="font-size:12px; color:#64748b; margin-top:2px;">Define a largura do conteúdo entre 60% e 100%.</div>
                    </div>
                    <div style="display:flex; align-items:center; gap:6px;">
                        <input type="number" id="pj-content-width" min="60" max="100" step="1" style="width:72px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; text-align:right;">
                        <span style="font-size:13px; color:#334155;">%</span>
                    </div>
                </label>
                <div style="font-size:12px; color:#64748b; margin-top:12px;">
                    As alterações são salvas e aplicadas imediatamente.
                </div>
            </div>
            <div style="display:flex; gap:8px; justify-content:flex-end; padding:12px 16px; border-top:1px solid #e5e7eb; background:#f8fafc;">
                <button id="pj-reset" style="padding:7px 11px; min-width:86px; border:1px solid #cbd5e1; background:#fff; border-radius:8px; cursor:pointer;">Padrão</button>
                <button id="pj-cancel" style="padding:7px 11px; min-width:86px; border:1px solid #cbd5e1; background:#fff; border-radius:8px; cursor:pointer;">Fechar</button>
                <button id="pj-save" style="padding:7px 11px; min-width:86px; background:#0f3e75; color:#fff; border:0; border-radius:8px; cursor:pointer; font-weight:600;">Salvar</button>
            </div>
        `;

        overlay.appendChild(scopedStyle);
        overlay.appendChild(panel);
        document.body.appendChild(overlay);
        document.body.style.overflow = "hidden";
        requestAnimationFrame(() => {
            panel.style.transform = "translateY(0) scale(1)";
            panel.style.opacity = "1";
        });

        const autoHide = panel.querySelector("#pj-auto-hide");
        const iframeH = panel.querySelector("#pj-iframe-height");
        const contentW = panel.querySelector("#pj-content-width");

        autoHide.checked = !!settings.autoHideHeader;
        iframeH.checked = !!settings.enableIframeAutoHeight;
        contentW.value = String(sanitizeWidthPercent(settings.contentWidthPercent));

        const escClose = (ev) => {
            if (ev.key !== "Escape") return;
            closePanel();
        };

        const closePanel = () => {
            document.removeEventListener("keydown", escClose);
            document.body.style.overflow = previousBodyOverflow;
            overlay.remove();
        };

        panel.querySelector("#pj-close").addEventListener("click", closePanel);
        panel.querySelector("#pj-cancel").addEventListener("click", closePanel);

        panel.querySelector("#pj-reset").addEventListener("click", () => {
            autoHide.checked = DEFAULT_SETTINGS.autoHideHeader;
            iframeH.checked = DEFAULT_SETTINGS.enableIframeAutoHeight;
            contentW.value = String(DEFAULT_SETTINGS.contentWidthPercent);
        });

        panel.querySelector("#pj-save").addEventListener("click", () => {
            const widthPercent = sanitizeWidthPercent(contentW.value);
            contentW.value = String(widthPercent);
            saveSettings({
                autoHideHeader: autoHide.checked,
                enableIframeAutoHeight: iframeH.checked,
                contentWidthPercent: widthPercent
            });
            if (isTopWindow()) {
                injectTopHeaderCSS();
                injectWidthCSS(document);
                retryInjectInIframe(3, 120);
            }
            closePanel();
        });

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) closePanel();
        });

        document.addEventListener("keydown", escClose);
    }

    function injectTopHeaderCSS() {
        const widthPercent = sanitizeWidthPercent(settings.contentWidthPercent);
        const widthValue = widthPercent + "%";
        const centeredMargins = widthPercent < 100 ? "auto" : "0";

        const css = `
            :root {
                --pj-header-pad: 20px;
            }

            #Cabecalho {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                background-color: #004b8d !important;
                box-shadow: 0 2px 4px rgba(0,0,0,.15);
            }

            #pgn_cabecalho {
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
                box-sizing: border-box !important;
                padding-left: var(--pj-header-pad) !important;
                padding-right: var(--pj-header-pad) !important;
            }

            #img_logotj {
                margin-left: 0 !important;
            }

            /* Evita quebra de linha dos ícones utilitários da direita */
            #pgn_cabecalho > div[style*="float: right"] {
                white-space: nowrap !important;
                display: inline-block !important;
                float: right !important;
                max-width: 100% !important;
            }

            #pgn_cabecalho > div[style*="float: right"] > * {
                float: none !important;
                display: inline-block !important;
                vertical-align: middle !important;
            }

            /* Mantém o menu principal alinhado com a logo */
            #cssmenu {
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
                box-sizing: border-box !important;
                padding-left: var(--pj-header-pad) !important;
                padding-right: var(--pj-header-pad) !important;
            }

            #cssmenu > ul {
                margin-left: 0 !important;
                padding-left: 0 !important;
            }

            /* Não força cor global de ícones para evitar submenu branco */
            #cssmenu > ul > li > a,
            #cssmenu > ul > li > a i {
                color: #ffffff !important;
            }

            #cssmenu ul ul a,
            #cssmenu ul ul i,
            #cssmenu ul ul li > a {
                color: #2f2f2f !important;
            }

            #cssmenu ul ul li:hover > a,
            #cssmenu ul ul li:hover > a i {
                color: #0f3e75 !important;
            }

            /* Relógio na segunda linha, abaixo dos ícones da direita */
            #cronometro {
                float: right !important;
                margin-right: var(--pj-header-pad) !important;
                margin-left: 0 !important;
            }

            body > div[style*="height:28px"][style*="background-color:#ccc"] {
                border-bottom: 1px solid #cbd5e1;
            }
        `;

        let style = document.getElementById("projudi-top-header-style");
        if (!style) {
            style = document.createElement("style");
            style.id = "projudi-top-header-style";
            document.head.appendChild(style);
        }
        style.textContent = css;
    }

    function ajustarAlturaIframe() {
        if (!settings.enableIframeAutoHeight) return;

        const iframe = document.getElementById("Principal");
        if (!iframe) return;

        const cabecalho = document.getElementById("Cabecalho");
        const barraCinza = Array.from(document.body.children).find(
            d =>
                d !== iframe &&
                d.style &&
                d.style.height === "28px" &&
                d.style.backgroundColor === "#ccc"
        );

        let offsetTop = 0;
        if (cabecalho && cabecalho.offsetHeight) offsetTop += cabecalho.offsetHeight;
        if (barraCinza && barraCinza.offsetHeight) offsetTop += barraCinza.offsetHeight;

        const h = window.innerHeight - offsetTop;
        if (h > 200) iframe.style.height = h + "px";
    }

    let headerHidden = false;
    function setHeaderHidden(hidden) {
        const cab = document.getElementById("Cabecalho");
        if (!cab) return;
        headerHidden = hidden;
        cab.style.transition = "transform .25s ease";
        cab.style.willChange = "transform";
        cab.style.transform = hidden ? "translateY(-100%)" : "translateY(0)";
        setTimeout(ajustarAlturaIframe, 260);
    }

    function setupHeaderAutoHide() {
        if (!settings.autoHideHeader) return;
        const iframe = document.getElementById("Principal");
        if (!iframe) return;

        iframe.addEventListener("mouseenter", () => setHeaderHidden(true));
        document.addEventListener("mousemove", e => {
            if (e.clientY < 80) setHeaderHidden(false);
        });
    }

    function canInjectIntoDoc(doc) {
        const html = doc.documentElement;
        const body = doc.body;
        return !(
            (html && html.hasAttribute(OPTOUT_ATTR)) ||
            (body && body.hasAttribute(OPTOUT_ATTR))
        );
    }

    function injectWidthCSS(doc) {
        if (!doc || !doc.head || !canInjectIntoDoc(doc)) return;
        const widthPercent = sanitizeWidthPercent(settings.contentWidthPercent);
        const widthValue = widthPercent + "%";
        const centeredMargins = widthPercent < 100 ? "auto" : "0";

        const styleId = "projudi-ajuste-largura";
        let style = doc.getElementById(styleId);

        const css = `
            html, body {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                box-sizing: border-box !important;
            }

            #divCorpo,
            .divCorpo,
            #Corpo,
            #conteudo,
            #conteudoPrincipal,
            #pgn_corpo,
            #divEditar,
            #Formulario,
            .Tela,
            .Corpo,
            .conteudo,
            #content,
            #container,
            #principal,
            .container,
            .wrapper,
            .main,
            table[width="980"],
            table[width="1000"] {
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
                box-sizing: border-box !important;
            }

            table,
            .Tabela,
            .divTabela,
            .divTabela table {
                max-width: 100% !important;
            }

            /* Fallback para layouts com largura fixa inline */
            body > div[style*="width:"][style*="margin"],
            body > table[style*="width:"] {
                width: ${widthValue} !important;
                max-width: ${widthValue} !important;
                margin-left: ${centeredMargins} !important;
                margin-right: ${centeredMargins} !important;
            }
        `;

        if (!style) {
            style = doc.createElement("style");
            style.id = styleId;
            doc.head.appendChild(style);
        }

        style.textContent = css;
    }

    function isStandaloneContentPage() {
        if (!isTopWindow()) return false;
        if (document.getElementById("Principal")) return false;

        return (
            /\/BuscaProcesso\b/i.test(window.location.pathname) ||
            /\bId_Processo=/i.test(window.location.search) ||
            !!document.querySelector(
                "#divCorpo, .divCorpo, #Corpo, #conteudo, #conteudoPrincipal, #pgn_corpo, #Formulario, .Tela, .Corpo, .conteudo"
            )
        );
    }

    function injectCSSInIframe() {
        const iframe = document.getElementById("Principal");
        if (!iframe || !iframe.contentDocument) return;

        iframe.style.width = "100%";
        iframe.style.display = "block";

        injectWidthCSS(iframe.contentDocument);
    }

    function retryInjectInIframe(times = 12, delay = 240) {
        let n = 0;
        const tick = () => {
            injectCSSInIframe();
            ajustarAlturaIframe();
            n += 1;
            if (n < times) setTimeout(tick, delay);
        };
        tick();
    }

    function bindIframeLoadListener() {
        const iframe = document.getElementById("Principal");
        if (!iframe || iframeLoadBound) return;

        iframeLoadBound = true;
        iframe.addEventListener("load", () => {
            retryInjectInIframe(14, 220);
        });

        retryInjectInIframe(14, 220);
    }

    function watchForIframeAvailability() {
        bindIframeLoadListener();

        const observer = new MutationObserver(() => {
            bindIframeLoadListener();
            ajustarAlturaIframe();
        });

        observer.observe(document.body, { childList: true, subtree: true });

        setTimeout(bindIframeLoadListener, 500);
        setTimeout(bindIframeLoadListener, 1200);
        setTimeout(bindIframeLoadListener, 2400);
    }

    function initTop() {
        injectTopHeaderCSS();
        ajustarAlturaIframe();
        if (isStandaloneContentPage()) injectWidthCSS(document);

        window.addEventListener("resize", ajustarAlturaIframe);

        setupHeaderAutoHide();
        watchForIframeAvailability();

        const standaloneObserver = new MutationObserver(() => {
            if (isStandaloneContentPage()) injectWidthCSS(document);
        });
        standaloneObserver.observe(document.body, { childList: true, subtree: true });
    }

    function initInsideFrame() {
        injectWidthCSS(document);
    }

    function init() {
        if (isTopWindow()) {
            registerMenu();
            initTop();
        } else {
            initInsideFrame();
        }
    }

    if (document.readyState === "complete" || document.readyState === "interactive") {
        setTimeout(init, 300);
    } else {
        document.addEventListener("DOMContentLoaded", () => setTimeout(init, 300));
    }
})();