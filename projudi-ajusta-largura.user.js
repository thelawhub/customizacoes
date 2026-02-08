// ==UserScript==
// @name         Ajusta a Largura da Página
// @namespace    projudi-ajusta-largura.user.js
// @version      1.1
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
        hotkeyToggleHeader: false,
        enableIframeAutoHeight: true
    };

    const OPTOUT_ATTR = "data-projudi-wide-optout";
    let settings = loadSettings();

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
        if (typeof GM_setValue === "function") {
            GM_setValue(STORAGE_KEY, JSON.stringify(settings));
        }
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

        const overlay = document.createElement("div");
        overlay.id = "projudi-wide-panel-overlay";
        overlay.style.cssText = `
            position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 2147483647;
            display: flex; align-items: center; justify-content: center;
        `;

        const panel = document.createElement("div");
        panel.style.cssText = `
            width: 420px; max-width: calc(100vw - 32px); background: #fff; color: #111;
            border-radius: 10px; box-shadow: 0 14px 40px rgba(0,0,0,.3);
            font-family: Arial, sans-serif; overflow: hidden;
        `;

        panel.innerHTML = `
            <div style="padding:12px 14px; background:#0f3e75; color:#fff; font-weight:700;">
                Ajustes do Script
            </div>
            <div style="padding:14px;">
                <label style="display:flex; gap:8px; margin-bottom:10px;">
                    <input type="checkbox" id="pj-auto-hide">
                    <span>Ocultar cabeçalho automaticamente</span>
                </label>
                <label style="display:flex; gap:8px; margin-bottom:10px;">
                    <input type="checkbox" id="pj-hotkey-toggle">
                    <span>Atalho Ctrl + Alt + C para alternar cabeçalho</span>
                </label>
                <label style="display:flex; gap:8px; margin-bottom:2px;">
                    <input type="checkbox" id="pj-iframe-height">
                    <span>Ajuste automático de altura do iframe</span>
                </label>
                <div style="font-size:12px; color:#666; margin-top:10px;">
                    As alterações são salvas e aplicadas após recarregar a página.
                </div>
            </div>
            <div style="display:flex; gap:8px; justify-content:flex-end; padding:12px 14px; border-top:1px solid #e5e7eb;">
                <button id="pj-reset" style="padding:7px 10px;">Padrão</button>
                <button id="pj-cancel" style="padding:7px 10px;">Cancelar</button>
                <button id="pj-save" style="padding:7px 10px; background:#0f3e75; color:#fff; border:0; border-radius:4px;">Salvar</button>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const autoHide = panel.querySelector("#pj-auto-hide");
        const hotkey = panel.querySelector("#pj-hotkey-toggle");
        const iframeH = panel.querySelector("#pj-iframe-height");

        autoHide.checked = !!settings.autoHideHeader;
        hotkey.checked = !!settings.hotkeyToggleHeader;
        iframeH.checked = !!settings.enableIframeAutoHeight;

        panel.querySelector("#pj-cancel").addEventListener("click", () => overlay.remove());

        panel.querySelector("#pj-reset").addEventListener("click", () => {
            autoHide.checked = DEFAULT_SETTINGS.autoHideHeader;
            hotkey.checked = DEFAULT_SETTINGS.hotkeyToggleHeader;
            iframeH.checked = DEFAULT_SETTINGS.enableIframeAutoHeight;
        });

        panel.querySelector("#pj-save").addEventListener("click", () => {
            saveSettings({
                autoHideHeader: autoHide.checked,
                hotkeyToggleHeader: hotkey.checked,
                enableIframeAutoHeight: iframeH.checked
            });
            overlay.remove();
            window.location.reload();
        });

        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) overlay.remove();
        });
    }

    function injectTopHeaderCSS() {
        if (document.getElementById("projudi-top-header-style")) return;

        const css = `
            #Cabecalho {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                background-color: #004b8d !important;
                box-shadow: 0 2px 4px rgba(0,0,0,.15);
            }

            #pgn_cabecalho {
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 !important;
                padding: 4px 20px 6px 20px;
                box-sizing: border-box;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 16px;
            }

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

            #pgn_cabecalho > div[style*="float: right"],
            #pgn_cabecalho .projudi-right-wrap {
                float: none !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-end !important;
                gap: 12px !important;
                margin-left: auto !important;
                min-width: 0;
            }

            #cssmenu { margin: 0 !important; }
            #cssmenu ul { margin: 0; }

            #cssmenu a, #cssmenu i { color: #ffffff !important; }
            #cssmenu li:hover > a, #cssmenu li:hover > i { color: #facc15 !important; }

            #cronometro {
                position: static !important;
                float: none !important;
                margin: 0 !important;
                color: #ffffff !important;
                white-space: nowrap;
                font-weight: 600;
            }

            body > div[style*="height:28px"][style*="background-color:#ccc"] {
                background-color: #e5e7eb !important;
                border-bottom: 1px solid #cbd5e1;
            }
        `;

        const style = document.createElement("style");
        style.id = "projudi-top-header-style";
        style.textContent = css;
        document.head.appendChild(style);
    }

    function moveClockToRight() {
        const cabecalhoInner = document.getElementById("pgn_cabecalho");
        const clock = document.getElementById("cronometro");
        const menu = document.getElementById("cssmenu");
        if (!cabecalhoInner || !clock || !menu) return;

        let rightWrap = cabecalhoInner.querySelector(".projudi-right-wrap");
        if (!rightWrap) {
            rightWrap = document.createElement("div");
            rightWrap.className = "projudi-right-wrap";
            cabecalhoInner.appendChild(rightWrap);
        }

        if (clock.parentElement !== rightWrap) rightWrap.appendChild(clock);
        if (menu.parentElement !== rightWrap) rightWrap.appendChild(menu);
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

    function setupHotkeyToggle() {
        if (!settings.hotkeyToggleHeader) return;
        window.addEventListener("keydown", e => {
            if (e.ctrlKey && e.altKey && (e.key === "c" || e.key === "C")) {
                e.preventDefault();
                setHeaderHidden(!headerHidden);
            }
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

    function injectCSSInIframe() {
        const iframe = document.getElementById("Principal");
        if (!iframe || !iframe.contentDocument) return;

        iframe.style.width = "100%";
        iframe.style.display = "block";

        const doc = iframe.contentDocument;
        if (!canInjectIntoDoc(doc)) return;

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
            .conteudo {
                width: 100% !important;
                max-width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                box-sizing: border-box !important;
            }

            table,
            .Tabela,
            .divTabela,
            .divTabela table {
                max-width: 100% !important;
            }
        `;

        if (!style) {
            style = doc.createElement("style");
            style.id = styleId;
            doc.head.appendChild(style);
        }
        style.textContent = css;
    }

    function retryInjectInIframe(times = 10, delay = 240) {
        let n = 0;
        const tick = () => {
            injectCSSInIframe();
            ajustarAlturaIframe();
            n += 1;
            if (n < times) setTimeout(tick, delay);
        };
        tick();
    }

    function registrarOnLoadNoIframe() {
        const iframe = document.getElementById("Principal");
        if (!iframe) return;

        iframe.addEventListener("load", () => {
            retryInjectInIframe(12, 240);
        });

        retryInjectInIframe(12, 240);
    }

    function initTop() {
        injectTopHeaderCSS();
        moveClockToRight();
        ajustarAlturaIframe();

        window.addEventListener("resize", ajustarAlturaIframe);

        const observer = new MutationObserver(() => moveClockToRight());
        observer.observe(document.body, { childList: true, subtree: true });

        setupHeaderAutoHide();
        setupHotkeyToggle();
        registrarOnLoadNoIframe();
    }

    function initInsideFrame() {
        if (document.getElementById("projudi-ajuste-largura-interno")) return;
        if (!canInjectIntoDoc(document)) return;

        const style = document.createElement("style");
        style.id = "projudi-ajuste-largura-interno";
        style.textContent = `
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
            .conteudo {
                width: 100% !important;
                max-width: 100% !important;
                margin-left: 0 !important;
                margin-right: 0 !important;
                box-sizing: border-box !important;
            }

            table,
            .Tabela,
            .divTabela,
            .divTabela table {
                max-width: 100% !important;
            }
        `;
        document.head.appendChild(style);
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