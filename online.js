// Собрано build.py из lampa/core.js и plugins/online/plugin.js.
// Правки вносятся в исходники, этот файл перезаписывается.
// Общая обвязка для плагинов Lampa: запуск, манифест, стили, доступ к открытой
// карточке фильма и сеть. Файл вклеивается в начало каждого плагина сборкой
// (build.py), так что в рантайме он уже часть плагина и отдельным запросом не
// тянется.
(function () {
    'use strict';

    // Два собранных плагина несут по своей копии ядра. Первая выигрывает —
    // API у них одинаковое, а двойное определение ничего не даёт.
    if (window.LampaCore) return;

    var Core = {};

    // Lampa поднимается не мгновенно, а как расширение браузера плагин
    // выполняется вообще раньше страницы. Ждём готовности обоих.
    function waitForLampa(attempt, ready, giveup) {
        var available = typeof Lampa !== 'undefined' && Lampa.Storage && Lampa.Component &&
            Lampa.Activity && Lampa.Controller && Lampa.Listener && typeof window.$ === 'function';

        if (available) {
            if (window.appready) return ready();

            return Lampa.Listener.follow('app', function (e) {
                if (e.type === 'ready') ready();
            });
        }

        if (attempt > 300) return giveup();

        setTimeout(function () { waitForLampa(attempt + 1, ready, giveup); }, 200);
    }

    // Часть плагинов кладёт в Manifest.plugins объект, часть — массив. Приводим
    // к массиву: иначе второй установленный плагин затирает запись первого, и
    // тот пропадает из списка расширений.
    function registerManifest(manifest) {
        if (!Array.isArray(Lampa.Manifest.plugins)) {
            Lampa.Manifest.plugins = Lampa.Manifest.plugins ? [Lampa.Manifest.plugins] : [];
        }

        var known = Lampa.Manifest.plugins.some(function (plugin) {
            return plugin && plugin.name === manifest.name;
        });

        if (!known) Lampa.Manifest.plugins.push(manifest);
    }

    // options: { flag, manifest, styles: { id, css }, start }
    Core.boot = function (options) {
        // Плагин может приехать дважды: и как расширение браузера, и из списка
        // плагинов Lampa. Второй раз просто выходим.
        if (window[options.flag]) return;
        window[options.flag] = true;

        waitForLampa(0, function () {
            registerManifest(options.manifest);
            if (options.styles) Core.addStyles(options.styles.id, options.styles.css);
            options.start();
        }, function () {
            console.error(options.manifest.name + ': Lampa так и не появилась, сдаёмся');
        });
    };

    Core.addStyles = function (id, css) {
        if (document.getElementById(id)) return;

        var style = document.createElement('style');
        style.id = id;
        style.textContent = css;
        document.head.appendChild(style);
    };

    Core.stored = function (name, fallback) {
        return String(Lampa.Storage.get(name, fallback) || fallback);
    };

    // Разные источники зовут тип по-разному, а часть карточек не несёт его
    // вовсе — тогда опознаём по полям, которые есть только у сериалов.
    Core.cardMethod = function (data) {
        if (!data) return 'movie';
        if (data.method === 'movie' || data.method === 'tv') return data.method;
        if (data.media_type === 'movie' || data.media_type === 'tv') return data.media_type;
        if (data.type === 'movie' || data.type === 'tv') return data.type;
        return (data.number_of_seasons || data.first_air_date || data.name) ? 'tv' : 'movie';
    };

    Core.cardYear = function (card) {
        var year = Number(String((card && (card.release_date || card.first_air_date)) || '').slice(0, 4));
        return year || 0;
    };

    Core.cardTitle = function (card) {
        return (card && (card.title || card.name || card.original_title || card.original_name)) || '';
    };

    // Открытая карточка целиком: сама запись, её тип и корень активности.
    // Искать по документу нельзя — прошлые карточки остаются в DOM, и запрос
    // вернёт кнопки фильма, который человек уже закрыл.
    function currentCard() {
        var active = Lampa.Activity.active();
        var card = active && active.card;

        if (!card || !card.id || !active.activity) return null;

        var method = (active.method === 'movie' || active.method === 'tv')
            ? active.method
            : Core.cardMethod(card);

        return { card: card, method: method, render: active.activity.render(), activity: active.activity };
    }

    Core.currentCard = currentCard;

    // 'complite' — опечатка самой Lampa, событие приходит именно так
    Core.onFullCard = function (callback) {
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;

            var ctx = currentCard();
            if (ctx) callback(ctx);
        });
    };

    // Свежие сборки Lampa разметили карточку заново, старые ещё живут со
    // старыми классами — ищем по обоим.
    Core.cardButtons = function (ctx) {
        return ctx.render.find('.full-start-new__buttons, .full-start__buttons');
    };

    Core.cardLeft = function (ctx) {
        return ctx.render.find('.full-start-new__left, .full-start__left');
    };

    // Кнопка в ряду под постером. Разметку копируем у родных кнопок: Lampa сама
    // и стилизует её, и прячет подпись у второстепенных.
    // options: { className, icon, title, onEnter, after }
    Core.cardButton = function (ctx, options) {
        var container = Core.cardButtons(ctx);
        if (!container.length || container.find('.' + options.className).length) return null;

        var button = $(
            '<div class="full-start__button selector ' + options.className + '">' +
            (options.icon || '') +
            '<span>' + (options.title || '') + '</span>' +
            '</div>'
        );

        button.on('hover:enter', options.onEnter);

        var anchor = options.after ? container.find(options.after) : $();
        if (anchor.length) button.insertAfter(anchor.first());
        else container.prepend(button);

        return button;
    };

    // Строка вроде «сезон · серия» под названием. Кладём её туда же, куда
    // Lampa кладёт свои детали, чтобы она не висела отдельным блоком.
    Core.cardDetails = function (ctx, className, html) {
        var line = ctx.render.find('.' + className);

        if (!line.length) {
            line = $('<div class="full-start-new__details ' + className + '"></div>');

            var rate = ctx.render.find('.full-start-new__rate-line');
            var details = ctx.render.find('.full-start-new__details').not('.' + className);
            var left = Core.cardLeft(ctx);

            if (rate.length) line.insertAfter(rate.first());
            else if (details.length) line.insertAfter(details.first());
            else if (left.length) left.append(line);
            else return null;
        }

        line.html(html);
        return line;
    };

    function encodeBody(options) {
        if (options.form) {
            return Object.keys(options.form).map(function (name) {
                return encodeURIComponent(name) + '=' + encodeURIComponent(options.form[name]);
            }).join('&');
        }

        return options.body === undefined ? null : JSON.stringify(options.body);
    }

    // Свой XHR, а не Lampa.Reguest: тому нельзя передать заголовки, а без
    // Authorization запрос к чужому API не пройдёт. TMDB по-прежнему ходит
    // через Lampa.Reguest — там важны пользовательские настройки прокси.
    // Тело задаётся либо `body` (уедет как json), либо `form` (как
    // application/x-www-form-urlencoded, чего требуют эндпоинты OAuth).
    // options: { url, method, headers, body, form, timeout, onDone, onFail }
    Core.request = function (options) {
        var xhr = new XMLHttpRequest();
        var headers = options.headers || {};

        xhr.open(options.method || 'GET', options.url, true);
        Object.keys(headers).forEach(function (name) {
            xhr.setRequestHeader(name, headers[name]);
        });
        xhr.timeout = options.timeout || 15000;

        function fail(status, body) {
            if (options.onFail) options.onFail(status, body);
        }

        xhr.onload = function () {
            var parsed = null;

            try {
                if (xhr.responseText) parsed = JSON.parse(xhr.responseText);
            } catch (e) {
                // Тело не json — для успешного ответа это нормально (204),
                // для ошибки разбирать всё равно нечего.
            }

            if (xhr.status >= 200 && xhr.status < 300) {
                if (options.onDone) options.onDone(parsed, xhr.status);
            } else {
                fail(xhr.status, parsed);
            }
        };

        xhr.onerror = function () { fail(0, null); };
        xhr.ontimeout = function () { fail(0, null); };

        xhr.send(encodeBody(options));

        return xhr;
    };

    window.LampaCore = Core;
})();

(function () {
    'use strict';

    var Core = window.LampaCore;

    var manifest = {
        type: 'video',
        version: '1.0.0',
        name: 'Онлайн',
        description: 'Видео с онлайн-балансеров через серверы Lampac',
        component: 'online_parser'
    };

    var COMPONENT = 'online_parser';

    // Своих парсеров у плагина нет, и это сознательно. Балансеры (Rezka,
    // Collaps, HDVB, VideoDB, Zetflix и прочие) закрыты CORS, прячут потоки за
    // токенами и шифрованием и меняют их каждые пару недель — в браузере
    // такое не разобрать, а если и разобрать, то ненадолго. Поэтому и
    // z01.online/online.js, и bwa.ad/rc, и остальные «онлайн»-плагины — это
    // клиенты к серверу Lampac, который парсит балансеры у себя. Протокол у
    // всех таких серверов один, так что плагин работает с любым из них, а их
    // список задаётся в настройках.
    //
    // По умолчанию — открытые серверы, которые пускают без аккаунта и
    // отвечают Lampa с CORS (проверено в сентябре 2026). Порядок — это и
    // приоритет: при прочих равных открывается балансер первого сервера.
    // wtch.ch и smotret24.ru живут только по http — их используют
    // приложения Lampa на телевизорах и Android, а с https-страницы
    // браузер их не пустит (см. servers()). rc.bwa.ad почти всё отдаёт
    // через rch, поэтому он последний.
    var DEFAULT_SERVERS = [
        'https://z01.online/',
        'https://lam.akter-black.com/',
        'https://lam.maxvol.pro/',
        'http://wtch.ch/',
        'http://smotret24.ru/',
        'https://rc.bwa.ad/'
    ].join(', ');

    var SERVERS_KEY = 'online_parser_servers';
    var BUTTON_KEY = 'online_parser_button';
    var RCH_KEY = 'online_parser_rch';
    var CHOICE_KEY = 'online_parser_choice';
    var LAST_SOURCE_KEY = 'online_parser_source';
    // Результаты проверки источников по каждому фильму — чтобы повторно
    // открыть его мгновенно, а не ждать проверку заново
    var CHECKS_KEY = 'online_parser_checks';
    var CHECKS_TTL = 30 * 60 * 1000;
    var CHECKS_KEEP = 30;

    // Эти ключи общие со всеми клиентами Lampac, и это полезно. uid сервер
    // привязывает к оплаченному доступу — купленный через чужой плагин премиум
    // заработает и здесь. online_view и хэши таймлайна посчитаны так же, как
    // у них, так что отметки «просмотрено» и позиция в серии не теряются при
    // переходе с одного плагина на другой.
    var UID_KEY = 'lampac_unic_id';
    var NWS_ID_KEY = 'lampac_nws_id';
    var VIEWED_KEY = 'online_view';

    // Сервер Lampac отдаёт список балансеров не сразу: сначала memkey, потом
    // его опрашивают, пока каждый балансер не ответит, есть у него фильм или
    // нет. Дольше пятнадцати секунд не ждём — кто не успел, тот серый.
    var LIFE_POLLS = 15;
    var LIFE_INTERVAL = 1000;

    var ICON = '<svg viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M21 3H3a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5v2h8v-2h5a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 14H3V5h18v12z"></path>' +
        '<path d="M10 7.5v7l6-3.5z"></path>' +
        '</svg>';

    var FOLDER_ICON = '<svg viewBox="0 0 128 112" fill="none">' +
        '<rect y="20" width="128" height="92" rx="13" fill="white"></rect>' +
        '<path d="M29.9963 8H98.0037C96.0446 3.3021 91.4079 0 86 0H42C36.5921 0 31.9555 3.3021 29.9963 8Z" fill="white" fill-opacity="0.23"></path>' +
        '<rect x="11" y="8" width="106" height="76" rx="13" fill="white" fill-opacity="0.51"></rect>' +
        '</svg>';

    var VIEWED_ICON = '<svg viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"></path>' +
        '</svg>';

    var STYLES = `
        .online-parser { position: relative; display: flex; border-radius: 0.3em; background-color: rgba(0,0,0,0.3); }
        .online-parser + .online-parser { margin-top: 1.5em; }
        .online-parser.focus::after {
            content: ''; position: absolute; top: -0.6em; left: -0.6em; right: -0.6em; bottom: -0.6em;
            border-radius: 0.7em; border: solid 0.3em #fff; z-index: -1; pointer-events: none;
        }
        .online-parser--soon { opacity: 0.5; }
        .online-parser__img { position: relative; width: 13em; min-height: 8.2em; flex-shrink: 0; }
        .online-parser__img > img {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%; object-fit: cover;
            border-radius: 0.3em; opacity: 0; transition: opacity 0.3s;
        }
        .online-parser__img--loaded > img { opacity: 1; }
        .online-parser__number {
            position: absolute; top: 0; left: 0; right: 0; bottom: 0;
            display: flex; align-items: center; justify-content: center; font-size: 2em;
        }
        .online-parser__img--loaded .online-parser__number { text-shadow: 0 0 0.5em rgba(0,0,0,0.8); }
        .online-parser__viewed {
            position: absolute; top: 1em; left: 1em; padding: 0.25em; font-size: 0.76em;
            background: rgba(0,0,0,0.45); border-radius: 100%;
        }
        .online-parser__viewed > svg { width: 1.5em; height: 1.5em; display: block; }
        .online-parser__folder { padding: 1em; flex-shrink: 0; }
        .online-parser__folder > svg { width: 4.4em; height: 4.4em; display: block; }
        .online-parser__folder > img { width: 7em; height: 7em; object-fit: cover; border-radius: 0.3em; display: block; }
        .online-parser__body { padding: 1.2em; line-height: 1.3; flex-grow: 1; min-width: 0; position: relative; }
        .online-parser__head, .online-parser__footer { display: flex; justify-content: space-between; align-items: center; }
        .online-parser__title {
            font-size: 1.7em; overflow: hidden; text-overflow: ellipsis;
            display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical;
        }
        .online-parser__time { padding-left: 2em; white-space: nowrap; }
        .online-parser__timeline { margin: 0.8em 0; }
        .online-parser__timeline > .time-line { display: block !important; }
        .online-parser__info { display: flex; align-items: center; min-width: 0; }
        .online-parser__info > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .online-parser__split { font-size: 0.8em; margin: 0 1em; flex-shrink: 0; }
        .online-parser__quality { padding-left: 1em; white-space: nowrap; }
        .online-parser--folder .online-parser__footer { margin-top: 0.8em; }
        .online-parser-empty { line-height: 1.4; padding: 1em 0; }
        .online-parser-empty__title { font-size: 1.8em; margin-bottom: 0.3em; }
        .online-parser-empty__text { font-size: 1.2em; font-weight: 300; margin-bottom: 1.6em; }
        .online-parser-empty__buttons { display: flex; flex-wrap: wrap; }
        .online-parser-empty__button {
            background: rgba(0,0,0,0.3); font-size: 1.2em; padding: 0.5em 1.2em;
            border-radius: 0.2em; margin: 0 1em 1em 0;
        }
        .online-parser-empty__button.focus { background: #fff; color: #000; }
        .online-parser-skeleton {
            background-color: rgba(255,255,255,0.3); padding: 1em; display: flex; align-items: center; border-radius: 0.3em;
        }
        .online-parser-skeleton + .online-parser-skeleton { margin-top: 1em; }
        .online-parser-skeleton:nth-child(3) { opacity: 0.5; }
        .online-parser-skeleton:nth-child(4) { opacity: 0.2; }
        .online-parser-skeleton > div { background: rgba(0,0,0,0.3); border-radius: 0.3em; }
        .online-parser-skeleton__ico { width: 4em; height: 4em; margin-right: 2.4em; }
        .online-parser-skeleton__body { height: 1.7em; width: 70%; }
        .online-parser-progress { font-size: 1.2em; opacity: 0.7; margin: 0.8em 0 1.2em; min-height: 1.3em; }
        .online-parser-loader {
            display: inline-block; width: 1.2em; height: 1.2em; margin-left: 0.5em; vertical-align: middle;
            background: url(./img/loader.svg) no-repeat 50% 50%; background-size: contain;
        }
        @media screen and (max-width: 480px) {
            .online-parser__img { width: 7em; min-height: 6em; }
            .online-parser__body { padding: 0.8em 1.2em; }
            .online-parser__title { font-size: 1.4em; }
        }
    `;

    // ---------------------------------------------------------------- утилиты

    function escapeHtml(text) {
        return String(text === undefined || text === null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pad(number) {
        return (number < 10 ? '0' : '') + number;
    }

    function addParam(url, name, value) {
        return Lampa.Utils.addUrlComponent(url, name + '=' + encodeURIComponent(value));
    }

    // Адрес сервера пишут как попало: без протокола, без слэша, через запятую
    // или с новой строки. Приводим к виду «https://host/», с которым
    // склеиваются пути API.
    function normalizeServer(raw) {
        var url = String(raw || '').trim();
        if (!url) return '';
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        if (url.charAt(url.length - 1) !== '/') url += '/';
        return url;
    }

    function servers() {
        var seen = {};
        // Со страницы по https браузер не пустит запрос на http-сервер
        // (mixed content) — нечего и ждать его ответа
        var secure = location.protocol === 'https:';

        return Core.stored(SERVERS_KEY, DEFAULT_SERVERS).split(/[\s,;]+/).map(normalizeServer).filter(function (url) {
            if (!url || seen[url]) return false;
            if (secure && /^http:/i.test(url)) return false;
            seen[url] = true;
            return true;
        });
    }

    function serverLabel(host) {
        return host.replace(/^https?:\/\//i, '').replace(/\/+$/, '').replace(/^www\./, '');
    }

    function uid() {
        var id = Lampa.Storage.get(UID_KEY, '');

        if (!id) {
            id = Lampa.Utils.uid(8).toLowerCase();
            Lampa.Storage.set(UID_KEY, id);
        }

        return id;
    }

    function nwsId() {
        var id = Lampa.Storage.get(NWS_ID_KEY, '');

        if (!id) {
            id = Lampa.Utils.uid(32).toLowerCase();
            Lampa.Storage.set(NWS_ID_KEY, id);
        }

        return id;
    }

    // Сервер узнаёт клиента по uid, а по email аккаунта CUB — открывает
    // доступ тем, у кого он есть (так делают серверы, закрытые для анонимов).
    function account(url) {
        url = String(url);

        var email = Lampa.Storage.get('account_email', '');
        if (email && url.indexOf('account_email=') === -1) url = addParam(url, 'account_email', email);
        if (url.indexOf('uid=') === -1) url = addParam(url, 'uid', uid());

        var nws = Lampa.Storage.get(NWS_ID_KEY, '');
        if (nws && url.indexOf('nws_id=') === -1) url = addParam(url, 'nws_id', nws);

        return url;
    }

    function hostOf(url) {
        var match = String(url || '').match(/^(https?:\/\/[^/?#]+)/i);
        return match ? match[1] + '/' : '';
    }

    // Серверы иногда отдают запасную ссылку через « or ». Берём первую,
    // вторую держим про запас — Lampa переключится на неё сама.
    function splitReserve(url) {
        var parts = String(url || '').split(' or ');
        return { url: parts[0], reserve: parts[1] || '' };
    }

    // ----------------------------------------------------------- remote client

    // «rch» — это когда сервер не может сходить на балансер сам (тот банит
    // IP датацентров) и просит клиента скачать страницу за него: по
    // websocket приходит адрес, клиент качает его и отдаёт тело обратно.
    // Так работает, например, rc.bwa.ad. В браузере это упирается в CORS,
    // поэтому толк от rch в основном на Android и Tizen.
    //
    // В протоколе есть ещё команды eval и evalrun — выполнить присланный
    // сервером код. Их плагин не исполняет никогда: это чужой код в контексте
    // Lampa с доступом к аккаунту. Адреса локальной сети тоже не качаем —
    // иначе через клиента можно было бы стучаться в домашний роутер.
    var rch_state = {};
    var rch_kind = null;

    function rchEnabled() {
        return !!Lampa.Storage.get(RCH_KEY, true);
    }

    function detectRchKind(host, done) {
        if (rch_kind) return done(rch_kind);

        if (Lampa.Platform.is('android')) return done(rch_kind = 'apk');
        if (Lampa.Platform.is('tizen')) return done(rch_kind = 'cors');

        // Сервер отвечает на /cors/check без CORS-заголовков. Если ответ всё
        // же прочитался, значит, браузер CORS не проверяет (обёртка, webview)
        // и клиент может ходить на балансеры сам.
        var network = new Lampa.Reguest();
        network.timeout(5000);
        network.silent(host + 'cors/check', function () {
            done(rch_kind = 'cors');
        }, function () {
            done(rch_kind = 'web');
        }, false, { dataType: 'text' });
    }

    function privateAddress(url) {
        var host = (String(url).match(/^https?:\/\/([^/:?#]+)/i) || [])[1];
        if (!host) return true;

        host = host.toLowerCase();

        return host === 'localhost' || /\.local$/.test(host) || /^127\./.test(host) || /^10\./.test(host) ||
            /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^0\./.test(host) ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host.indexOf('[') === 0;
    }

    function rchReply(host, id, text) {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', host + 'rch/result?id=' + encodeURIComponent(id), true);
        xhr.send(text || '');
    }

    function rchFetch(host, id, url, data, headers, return_headers) {
        if (url === 'ping') return rchReply(host, id, 'pong');

        if (!/^https?:\/\//i.test(url) || privateAddress(url)) {
            console.warn('Online: rch-команду не выполняем —', String(url).slice(0, 60));
            return rchReply(host, id, '');
        }

        var network = new Lampa.Reguest();
        network['native'](url, function (body) {
            if (typeof body !== 'string') body = JSON.stringify(body);
            rchReply(host, id, body);
        }, function () {
            rchReply(host, id, '');
        }, data || false, {
            dataType: 'text',
            timeout: 8000,
            headers: headers || {},
            returnHeaders: return_headers
        });
    }

    function rchConnect(host, nws, done) {
        var state = rch_state[host];

        if (state && state.ready) return done(true);

        if (!state) state = rch_state[host] = { waiters: [] };
        state.waiters.push(done);

        if (state.socket) return;

        function settle(ok) {
            clearTimeout(state.timer);
            var waiters = state.waiters;
            state.waiters = [];
            waiters.forEach(function (call) { call(ok); });
        }

        function send(method, args) {
            if (state.socket && state.socket.readyState === 1) {
                state.socket.send(JSON.stringify({ method: method, args: args }));
            }
        }

        detectRchKind(host, function (kind) {
            var url = addParam(addParam(nws, 'id', nwsId()), 'ver', 1);
            var socket;

            try {
                socket = new WebSocket(url);
            } catch (e) {
                return settle(false);
            }

            state.socket = socket;
            state.timer = setTimeout(function () { settle(false); }, 10000);

            socket.onopen = function () {
                state.ping = setInterval(function () {
                    if (socket.readyState === 1) socket.send('ping');
                }, 50000);
            };

            socket.onmessage = function (event) {
                if (event.data === 'pong') return;

                var message;
                try {
                    message = JSON.parse(event.data);
                } catch (e) {
                    return;
                }

                if (!message || typeof message.method !== 'string') return;

                var args = message.args || [];

                if (message.method === 'Connected') {
                    send('RchRegistry', [{
                        host: location.host,
                        rchtype: kind,
                        apkVersion: 0,
                        player: Lampa.Storage.field('player')
                    }]);
                } else if (message.method === 'RchRegistry') {
                    state.ready = true;
                    settle(true);
                } else if (message.method === 'RchClient') {
                    rchFetch(host, args[0], args[1], args[2], args[3], args[4]);
                }
            };

            socket.onclose = function () {
                clearInterval(state.ping);
                state.ready = false;
                state.socket = null;
                settle(false);
            };
        });
    }

    // --------------------------------------------------------------- шаблоны

    function addTemplates() {
        Lampa.Template.add('online_parser_item',
            '<div class="online-parser selector">' +
                '<div class="online-parser__img"><img alt=""></div>' +
                '<div class="online-parser__body">' +
                    '<div class="online-parser__head">' +
                        '<div class="online-parser__title">{title}</div>' +
                        '<div class="online-parser__time">{time}</div>' +
                    '</div>' +
                    '<div class="online-parser__timeline"></div>' +
                    '<div class="online-parser__footer">' +
                        '<div class="online-parser__info">{info}</div>' +
                        '<div class="online-parser__quality">{quality}</div>' +
                    '</div>' +
                '</div>' +
            '</div>');

        Lampa.Template.add('online_parser_folder',
            '<div class="online-parser online-parser--folder selector">' +
                '<div class="online-parser__folder">' + FOLDER_ICON + '</div>' +
                '<div class="online-parser__body">' +
                    '<div class="online-parser__head">' +
                        '<div class="online-parser__title">{title}</div>' +
                        '<div class="online-parser__time">{time}</div>' +
                    '</div>' +
                    '<div class="online-parser__footer">' +
                        '<div class="online-parser__info">{info}</div>' +
                    '</div>' +
                '</div>' +
            '</div>');

        Lampa.Template.add('online_parser_loading',
            '<div class="online-parser-empty">' +
                '<div class="broadcast__scan"><div></div></div>' +
                '<div class="online-parser-progress"></div>' +
                '<div class="online-parser-skeleton selector">' +
                    '<div class="online-parser-skeleton__ico"></div><div class="online-parser-skeleton__body"></div>' +
                '</div>' +
                '<div class="online-parser-skeleton">' +
                    '<div class="online-parser-skeleton__ico"></div><div class="online-parser-skeleton__body"></div>' +
                '</div>' +
                '<div class="online-parser-skeleton">' +
                    '<div class="online-parser-skeleton__ico"></div><div class="online-parser-skeleton__body"></div>' +
                '</div>' +
            '</div>');

        Lampa.Template.add('online_parser_message',
            '<div class="online-parser-empty">' +
                '<div class="online-parser-empty__title">{title}</div>' +
                '<div class="online-parser-empty__text">{text}</div>' +
                '<div class="online-parser-empty__buttons"></div>' +
            '</div>');
    }

    // Элементы в ответе Lampac — это html, где всё нужное лежит в data-json,
    // а сезон и серия — в атрибутах s и e.
    function parseElements(html, selector) {
        var result = [];

        html.find(selector).each(function () {
            var node = $(this);
            var data;

            try {
                data = JSON.parse(node.attr('data-json'));
            } catch (e) {
                return;
            }

            if (!data || typeof data !== 'object') return;

            var season = node.attr('s');
            var episode = node.attr('e');

            if (season) data.season = parseInt(season, 10);
            if (episode) data.episode = parseInt(episode, 10);

            data.text = $.trim(node.find('.videos__item-title, .videos__season-title').first().text() || node.text());
            data.active = node.hasClass('active');
            result.push(data);
        });

        return result;
    }

    // ------------------------------------------------------- прямые источники

    // Источники, которые плагин разбирает сам, без сервера Lampac. Годится
    // для этого только тот, у кого открытый API с CORS: ключей чужих
    // приложений и приватных прокси здесь нет и не будет. Ответ приводится к
    // тому же виду, что и у Lampac, — { items, buttons } с data-json внутри, —
    // так что дальше он идёт по общей дорожке: сезоны, озвучки, плеер.
    //
    // Каждый источник: match(movie) — стоит ли вообще искать, search(ctx, done)
    // — есть ли что-то (done(true/false)), load(ref, ctx, done) — содержимое по
    // ссылке вида «direct:<id>:<ref>».
    var DIRECT = {};

    function directRequest(url, ctx, done) {
        var match = String(url).match(/^direct:([^:]+):(.*)$/);
        var provider = match && DIRECT[match[1]];

        if (!provider) return done(null);
        provider.load(match[2], ctx, done);
    }

    function jsonGet(url, done) {
        var network = new Lampa.Reguest();
        network.timeout(15000);
        network.silent(url, function (json) { done(json); }, function () { done(null); });
    }

    function isAnime(movie) {
        var genres = (movie.genres || []).map(function (g) { return g.id; }).concat(movie.genre_ids || []);
        var animation = genres.indexOf(16) !== -1;
        var asian = ['ja', 'zh', 'ko'].indexOf(movie.original_language) !== -1;

        return animation && asian;
    }

    // Название для сравнения: без регистра, пунктуации и лишних пробелов
    function looseTitle(text) {
        return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
    }

    // AniLibria: открытый API на anilibria.top, CORS разрешён для любого
    // origin Lampa. Сезоны аниме у неё — отдельные релизы, поэтому у сериала
    // несколько подходящих релизов показываются как сезоны, по году.
    var ANILIBRIA_API = 'https://anilibria.top/api/v1/';

    DIRECT.anilibria = {
        name: 'AniLibria',

        match: isAnime,

        find: function (ctx, done) {
            var movie = ctx.movie;
            var queries = [movie.original_name || movie.original_title, movie.name || movie.title]
                .concat(ctx.search ? [ctx.search] : [])
                .filter(Boolean);
            var year = Core.cardYear(movie);
            var found = {};
            var list = [];

            (function next(i) {
                if (i >= queries.length) {
                    list.sort(function (a, b) { return (a.year || 0) - (b.year || 0); });
                    return done(list);
                }

                jsonGet(ANILIBRIA_API + 'app/search/releases?query=' + encodeURIComponent(queries[i]), function (json) {
                    (Array.isArray(json) ? json : []).forEach(function (release) {
                        if (!release || found[release.id]) return;

                        var type = release.type && release.type.value;
                        var movie_like = type === 'MOVIE';

                        // Фильм ищем среди фильмов, сериал — среди всего
                        // остального (TV, ONA, OVA, спэшлы)
                        if (ctx.serial === movie_like) return;
                        // Сериал идёт годами, а следующие сезоны — позже
                        // первого; фильм же должен совпасть по году
                        if (year && release.year && (ctx.serial ? release.year < year - 1 : Math.abs(release.year - year) > 1)) return;

                        found[release.id] = true;
                        list.push(release);
                    });

                    next(i + 1);
                });
            })(0);
        },

        search: function (ctx, done) {
            this.find(ctx, function (list) {
                ctx.anilibria = list;
                done(list.length > 0);
            });
        },

        load: function (ref, ctx, done) {
            var self = this;

            if (ref === 'search') {
                if (ctx.anilibria) return self.list(ctx.anilibria, ctx, done);

                return self.find(ctx, function (list) {
                    ctx.anilibria = list;
                    self.list(list, ctx, done);
                });
            }

            var parts = ref.split(':');
            self.release(parts[0], parseInt(parts[1], 10) || 1, ctx, done);
        },

        list: function (list, ctx, done) {
            if (!list.length) return done({ items: [], buttons: [] });
            if (list.length === 1) return this.release(list[0].id, 1, ctx, done);

            // Несколько релизов у сериала — это сезоны, если их названия
            // начинаются одинаково: «Sousou no Frieren» и «Sousou no Frieren
            // 2nd Season». Оригинальное название у аниме японское, с
            // латиницей AniLibria его не сравнить, поэтому основу берём у
            // самих релизов — самое короткое название среди найденных.
            function names(release) {
                return [release.name && release.name.english, release.name && release.name.main]
                    .map(looseTitle).filter(Boolean);
            }

            var base = list.map(names).reduce(function (all, n) { return all.concat(n); }, [])
                .sort(function (a, b) { return a.length - b.length; });
            var related = [];

            for (var b = 0; b < base.length && related.length < 2; b++) {
                related = list.filter(function (release) {
                    return names(release).some(function (name) { return name.indexOf(base[b]) === 0; });
                });
            }

            if (ctx.serial && related.length > 1) {
                return done({
                    items: related.map(function (release, i) {
                        return { method: 'link', url: 'direct:anilibria:' + release.id + ':' + (i + 1), text: (i + 1) + ' сезон · ' + release.year };
                    }),
                    buttons: []
                });
            }

            done({
                items: list.map(function (release) {
                    return {
                        method: 'link',
                        similar: true,
                        url: 'direct:anilibria:' + release.id + ':1',
                        text: release.name ? release.name.main : String(release.id),
                        title: release.name ? release.name.main : String(release.id),
                        year: release.year,
                        details: (release.type && release.type.description) || '',
                        img: release.poster && release.poster.optimized ? 'https://anilibria.top' + release.poster.optimized.src : ''
                    };
                }),
                buttons: []
            });
        },

        release: function (id, season, ctx, done) {
            jsonGet(ANILIBRIA_API + 'anime/releases/' + encodeURIComponent(id), function (release) {
                if (!release || !Array.isArray(release.episodes)) return done(null);

                var items = release.episodes.map(function (episode) {
                    var quality = {};
                    if (episode.hls_1080) quality['1080p'] = episode.hls_1080;
                    if (episode.hls_720) quality['720p'] = episode.hls_720;
                    if (episode.hls_480) quality['480p'] = episode.hls_480;

                    var url = episode.hls_1080 || episode.hls_720 || episode.hls_480;
                    if (!url) return null;

                    var item = {
                        method: 'play',
                        url: url,
                        quality: quality,
                        maxquality: Object.keys(quality)[0],
                        translate: 'AniLibria',
                        text: ctx.serial ? (episode.name || ('Серия ' + episode.ordinal)) : (release.name && release.name.main)
                    };

                    if (ctx.serial) {
                        item.season = season;
                        item.episode = Math.floor(episode.ordinal) || 1;
                    }

                    return item;
                }).filter(Boolean);

                done({ items: items, buttons: [] });
            });
        }
    };

    // ------------------------------------------------------ проверка потока

    // Относительная ссылка из m3u8. URL() на старых телевизорах нет.
    function resolveUrl(base, link) {
        if (/^https?:\/\//i.test(link)) return link;
        if (link.indexOf('//') === 0) return base.split('//')[0] + link;

        var origin = (base.match(/^(https?:\/\/[^/]+)/i) || [])[1] || '';
        if (link.charAt(0) === '/') return origin + link;

        return base.split('?')[0].replace(/[^/]*$/, '') + link;
    }

    // Начало ответа, без скачивания целиком: после limit байт запрос
    // обрывается. Range не ставим — это лишний preflight, который часть
    // CDN не пропускает. Читаем потоком через fetch: XHR копит весь ответ,
    // и на быстром канале или бесконечном потоке (торрент) успевает съесть
    // сотни мегабайт, прежде чем его оборвут.
    // done({ bytes, type, url, cut }) или null
    function peek(url, limit, done) {
        var finished = false;
        var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
        var timer = setTimeout(function () { finish(null); }, 10000);

        function finish(result) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (controller) {
                try { controller.abort(); } catch (e) {}
            }
            done(result);
        }

        if (typeof fetch === 'undefined' || !controller || typeof Uint8Array === 'undefined') return peekXhr(url, limit, finish);

        fetch(url, { signal: controller.signal, credentials: 'omit' }).then(function (response) {
            if (!response.ok || !response.body || !response.body.getReader) return finish(null);

            var reader = response.body.getReader();
            var chunks = [];
            var size = 0;
            var info = {
                type: response.headers.get('Content-Type') || '',
                url: response.url || url,
                length: parseInt(response.headers.get('Content-Length'), 10) || 0
            };

            function read() {
                reader.read().then(function (chunk) {
                    if (chunk.value) {
                        chunks.push(chunk.value);
                        size += chunk.value.length;
                    }

                    if (chunk.done || size >= limit) {
                        try { reader.cancel(); } catch (e) {}

                        var bytes = new Uint8Array(Math.min(size, limit));
                        var at = 0;
                        for (var i = 0; i < chunks.length && at < bytes.length; i++) {
                            var part = chunks[i].subarray(0, bytes.length - at);
                            bytes.set(part, at);
                            at += part.length;
                        }

                        return finish({
                            bytes: bytes,
                            type: info.type,
                            url: info.url,
                            cut: !chunk.done,
                            // Полный объём: из заголовка, а если ответ
                            // пришёл целиком — сколько пришло
                            length: info.length || (chunk.done ? size : 0)
                        });
                    }

                    read();
                })['catch'](function () { finish(null); });
            }

            read();
        })['catch'](function () { finish(null); });
    }

    // Для старых телевизоров без потокового fetch. x-user-defined отдаёт
    // байты как есть, по одному на символ.
    function peekXhr(url, limit, finish) {
        var xhr = new XMLHttpRequest();

        function result(ok) {
            var text = '';
            var type = '';
            try { text = xhr.responseText || ''; } catch (e) {}
            try { type = xhr.getResponseHeader('Content-Type') || ''; } catch (e) {}
            var status = xhr.status;
            try { xhr.abort(); } catch (e) {}

            if (!ok || status < 200 || status >= 400) return finish(null);

            var length = Math.min(text.length, limit);
            var bytes = typeof Uint8Array !== 'undefined' ? new Uint8Array(length) : [];
            for (var i = 0; i < length; i++) bytes[i] = text.charCodeAt(i) & 0xff;

            var total = 0;
            try { total = parseInt(xhr.getResponseHeader('Content-Length'), 10) || 0; } catch (e) {}
            var cut = text.length >= limit;

            finish({ bytes: bytes, type: type, url: xhr.responseURL || url, cut: cut, length: total || (cut ? 0 : text.length) });
        }

        try {
            xhr.open('GET', url, true);
            xhr.overrideMimeType('text/plain; charset=x-user-defined');
            xhr.onprogress = function () {
                var length = 0;
                try { length = (xhr.responseText || '').length; } catch (e) {}
                if (length >= limit) result(true);
            };
            xhr.onload = function () { result(true); };
            xhr.onerror = function () { finish(null); };
            xhr.send();
        } catch (e) {
            finish(null);
        }
    }

    // ------------------------------------------------ разрешение из видео

    // Балансеры пишут качество как хотят: «1080p» у потока 720p — обычное
    // дело. Настоящий размер кадра лежит в самом видео: в SPS кодека (H.264,
    // H.265) внутри сегмента TS или в заголовке трека mp4. Разбираем их
    // прямо из первых килобайт, которые проверка и так скачивает.

    function BitReader(bytes) {
        this.bytes = bytes;
        this.pos = 0;
    }

    BitReader.prototype.bit = function () {
        var byte = this.bytes[this.pos >> 3];
        if (byte === undefined) throw new Error('eof');
        var value = (byte >> (7 - (this.pos & 7))) & 1;
        this.pos++;
        return value;
    };

    BitReader.prototype.bits = function (n) {
        var value = 0;
        for (var i = 0; i < n; i++) value = value * 2 + this.bit();
        return value;
    };

    BitReader.prototype.skip = function (n) {
        this.pos += n;
    };

    // Экспоненциальный код Голомба
    BitReader.prototype.ue = function () {
        var zeros = 0;
        while (this.bit() === 0) {
            if (++zeros > 31) throw new Error('bad ue');
        }
        return Math.pow(2, zeros) - 1 + this.bits(zeros);
    };

    BitReader.prototype.se = function () {
        var value = this.ue();
        return value & 1 ? (value + 1) / 2 : -value / 2;
    };

    // Внутри NAL после двух нулей вставлен 0x03, чтобы данные не
    // спутались со стартовым кодом, — выкидываем его
    function unescapeNal(bytes, start, end) {
        var out = [];
        var zeros = 0;

        for (var i = start; i < end; i++) {
            var byte = bytes[i];
            if (zeros >= 2 && byte === 3) {
                zeros = 0;
                continue;
            }
            out.push(byte);
            zeros = byte === 0 ? zeros + 1 : 0;
        }

        return out;
    }

    function h264Size(nal) {
        var r = new BitReader(nal);
        r.skip(8); // заголовок NAL

        var profile = r.bits(8);
        r.skip(16); // флаги ограничений и уровень
        r.ue(); // id SPS

        var chroma = 1;

        if ([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135].indexOf(profile) !== -1) {
            chroma = r.ue();
            if (chroma === 3) r.skip(1);
            r.ue();
            r.ue();
            r.skip(1);

            if (r.bit()) {
                for (var i = 0; i < (chroma !== 3 ? 8 : 12); i++) {
                    if (!r.bit()) continue;

                    var size = i < 6 ? 16 : 64;
                    var last = 8;
                    var next = 8;

                    for (var j = 0; j < size; j++) {
                        if (next !== 0) next = (last + r.se() + 256) % 256;
                        if (next !== 0) last = next;
                    }
                }
            }
        }

        r.ue(); // log2_max_frame_num

        var poc = r.ue();
        if (poc === 0) {
            r.ue();
        } else if (poc === 1) {
            r.skip(1);
            r.se();
            r.se();
            var cycle = r.ue();
            for (var c = 0; c < cycle; c++) r.se();
        }

        r.ue(); // max_num_ref_frames
        r.skip(1);

        var width_mbs = r.ue() + 1;
        var height_units = r.ue() + 1;
        var frame_mbs_only = r.bit();
        if (!frame_mbs_only) r.skip(1);
        r.skip(1);

        var crop = [0, 0, 0, 0];
        if (r.bit()) crop = [r.ue(), r.ue(), r.ue(), r.ue()];

        var unit_x = chroma === 0 || chroma === 3 ? 1 : 2;
        var unit_y = (chroma === 1 ? 2 : 1) * (2 - frame_mbs_only);

        return {
            width: width_mbs * 16 - unit_x * (crop[0] + crop[1]),
            height: (2 - frame_mbs_only) * height_units * 16 - unit_y * (crop[2] + crop[3])
        };
    }

    function h265Size(nal) {
        var r = new BitReader(nal);
        r.skip(16); // заголовок NAL
        r.skip(4); // id VPS

        var sub_layers = r.bits(3);
        r.skip(1);

        // profile_tier_level
        r.skip(88);
        r.skip(8);

        var profile_present = [];
        var level_present = [];

        for (var i = 0; i < sub_layers; i++) {
            profile_present.push(r.bit());
            level_present.push(r.bit());
        }

        if (sub_layers > 0) {
            for (var k = sub_layers; k < 8; k++) r.skip(2);
        }

        for (var j = 0; j < sub_layers; j++) {
            if (profile_present[j]) r.skip(88);
            if (level_present[j]) r.skip(8);
        }

        r.ue(); // id SPS

        var chroma = r.ue();
        if (chroma === 3) r.skip(1);

        var width = r.ue();
        var height = r.ue();

        if (r.bit()) {
            var sub_w = chroma === 1 || chroma === 2 ? 2 : 1;
            var sub_h = chroma === 1 ? 2 : 1;
            var left = r.ue();
            var right = r.ue();
            var top = r.ue();
            var bottom = r.ue();

            width -= sub_w * (left + right);
            height -= sub_h * (top + bottom);
        }

        return { width: width, height: height };
    }

    function sane(size) {
        return size && size.width >= 128 && size.width <= 8192 && size.height >= 96 && size.height <= 4608 ? size : null;
    }

    // SPS в потоке NAL-единиц: ищем стартовый код 00 00 01 и за ним
    // заголовок нужного типа
    function spsFromNals(bytes, hevc) {
        for (var i = 0; i + 4 < bytes.length; i++) {
            if (bytes[i] !== 0 || bytes[i + 1] !== 0 || bytes[i + 2] !== 1) continue;

            var header = bytes[i + 3];
            var is_sps = hevc ? ((header >> 1) & 0x3f) === 33 : (header & 0x1f) === 7;
            if (!is_sps) continue;

            var end = i + 3;
            while (end + 2 < bytes.length && !(bytes[end] === 0 && bytes[end + 1] === 0 && (bytes[end + 2] === 1 || bytes[end + 2] === 0))) end++;

            try {
                var nal = unescapeNal(bytes, i + 3, Math.min(end, i + 3 + 512));
                var size = sane(hevc ? h265Size(nal) : h264Size(nal));
                if (size) return size;
            } catch (e) {
                // обрезанный или битый SPS — ищем следующий
            }
        }

        return null;
    }

    // MPEG-TS: из PAT узнаём PMT, из PMT — PID видео и кодек, потом
    // собираем полезную нагрузку этого PID и ищем в ней SPS
    function tsSize(bytes) {
        var start = -1;

        for (var s = 0; s < Math.min(bytes.length - 376, 188); s++) {
            if (bytes[s] === 0x47 && bytes[s + 188] === 0x47 && bytes[s + 376] === 0x47) {
                start = s;
                break;
            }
        }

        if (start < 0) return null;

        function payload(offset) {
            var afc = (bytes[offset + 3] >> 4) & 3;
            if (!(afc & 1)) return null;
            var at = offset + 4;
            if (afc & 2) at += 1 + bytes[offset + 4];
            return at < offset + 188 ? at : null;
        }

        var pmt_pid = -1;
        var video_pid = -1;
        var hevc = false;
        var video = [];

        for (var p = start; p + 188 <= bytes.length; p += 188) {
            if (bytes[p] !== 0x47) break;

            var pid = ((bytes[p + 1] & 0x1f) << 8) | bytes[p + 2];
            var unit_start = bytes[p + 1] & 0x40;
            var at = payload(p);
            if (at === null) continue;

            if (pid === 0 && unit_start && pmt_pid < 0) {
                var pat = at + 1 + bytes[at];
                var pat_end = Math.min(pat + 3 + (((bytes[pat + 1] & 0x0f) << 8) | bytes[pat + 2]) - 4, p + 188);
                for (var e = pat + 8; e + 4 <= pat_end; e += 4) {
                    var program = (bytes[e] << 8) | bytes[e + 1];
                    if (program !== 0) {
                        pmt_pid = ((bytes[e + 2] & 0x1f) << 8) | bytes[e + 3];
                        break;
                    }
                }
            } else if (pid === pmt_pid && unit_start && video_pid < 0) {
                var pmt = at + 1 + bytes[at];
                var pmt_end = Math.min(pmt + 3 + (((bytes[pmt + 1] & 0x0f) << 8) | bytes[pmt + 2]) - 4, p + 188);
                var entry = pmt + 12 + (((bytes[pmt + 10] & 0x0f) << 8) | bytes[pmt + 11]);

                while (entry + 5 <= pmt_end) {
                    var type = bytes[entry];
                    var es_pid = ((bytes[entry + 1] & 0x1f) << 8) | bytes[entry + 2];

                    if (type === 0x1b || type === 0x24) {
                        video_pid = es_pid;
                        hevc = type === 0x24;
                        break;
                    }

                    entry += 5 + (((bytes[entry + 3] & 0x0f) << 8) | bytes[entry + 4]);
                }
            } else if (pid === video_pid) {
                for (var b = at; b < p + 188; b++) video.push(bytes[b]);
                if (video.length > 4096) {
                    var found = spsFromNals(video, hevc);
                    if (found) return found;
                }
            }
        }

        return video.length ? spsFromNals(video, hevc) : null;
    }

    // mp4: ширина и высота видеодорожки лежат в tkhd числами 16.16.
    // У звуковой дорожки там нули, её пропускаем.
    function mp4Size(bytes) {
        for (var i = 4; i + 96 < bytes.length; i++) {
            if (bytes[i] !== 0x74 || bytes[i + 1] !== 0x6b || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue;

            var version = bytes[i + 4];
            var at = i + (version === 1 ? 92 : 80);
            if (at + 8 > bytes.length) continue;

            var width = ((bytes[at] << 8) | bytes[at + 1]) + bytes[at + 2] / 256;
            var height = ((bytes[at + 4] << 8) | bytes[at + 5]) + bytes[at + 6] / 256;
            var size = sane({ width: Math.round(width), height: Math.round(height) });

            if (size) return size;
        }

        return null;
    }

    // Длительность ролика из mvhd — если заголовок в начале файла
    function mp4Duration(bytes) {
        for (var i = 4; i + 40 < bytes.length; i++) {
            if (bytes[i] !== 0x6d || bytes[i + 1] !== 0x76 || bytes[i + 2] !== 0x68 || bytes[i + 3] !== 0x64) continue;

            var v1 = bytes[i + 4] === 1;
            var at = i + (v1 ? 24 : 16);
            var scale = ((bytes[at] << 24) >>> 0) + (bytes[at + 1] << 16) + (bytes[at + 2] << 8) + bytes[at + 3];
            var d = at + 4;
            var duration = v1
                ? (((bytes[d] << 24) >>> 0) + (bytes[d + 1] << 16) + (bytes[d + 2] << 8) + bytes[d + 3]) * 4294967296 +
                    ((bytes[d + 4] << 24) >>> 0) + (bytes[d + 5] << 16) + (bytes[d + 6] << 8) + bytes[d + 7]
                : ((bytes[d] << 24) >>> 0) + (bytes[d + 1] << 16) + (bytes[d + 2] << 8) + bytes[d + 3];

            if (scale > 0 && duration > 0) return duration / scale;
        }

        return 0;
    }

    function videoSize(bytes) {
        if (!bytes || bytes.length < 16) return null;
        if (bytes[0] === 0x47 || (bytes[188] === 0x47 && bytes[376] === 0x47)) return tsSize(bytes);
        return mp4Size(bytes) || spsFromNals(bytes, false) || spsFromNals(bytes, true);
    }

    // Класс качества по размеру кадра. Считаем и по ширине: у широкоэкранного
    // фильма 1920×800 — это 1080p, хотя высота всего 800.
    function qualityClass(size) {
        if (!size) return 0;
        var w = size.width;
        var h = size.height;

        if (w >= 3200 || h >= 1800) return 2160;
        if (w >= 2200 || h >= 1300) return 1440;
        if (w >= 1700 || h >= 1000) return 1080;
        if (w >= 1150 || h >= 700) return 720;
        if (w >= 700 || h >= 400) return 480;
        return 360;
    }

    function qualityNumber(name) {
        name = String(name || '');
        if (/4k|uhd/i.test(name)) return 2160;
        return parseInt(name, 10) || 0;
    }

    function qualityName(value) {
        return value >= 2160 ? '4K' : value ? value + 'p' : '';
    }

    // Байты в строку для m3u8: там только ASCII, так что без декодера
    function bytesText(bytes, limit) {
        var parts = [];
        var end = Math.min(bytes.length, limit || bytes.length);
        for (var i = 0; i < end; i += 8192) {
            parts.push(String.fromCharCode.apply(null, Array.prototype.slice.call(bytes, i, Math.min(i + 8192, end))));
        }
        return parts.join('');
    }

    // Объём ответа из заголовков, без тела: соединение рвётся, как только
    // пришли заголовки. Content-Length браузер отдаёт и через CORS.
    function headLength(url, done) {
        var finished = false;
        var timer = setTimeout(function () { finish(0); }, 10000);

        function finish(length) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            done(length);
        }

        if (typeof fetch !== 'undefined' && typeof AbortController !== 'undefined') {
            var controller = new AbortController();

            return fetch(url, { signal: controller.signal, credentials: 'omit' }).then(function (response) {
                var length = response.ok ? parseInt(response.headers.get('Content-Length'), 10) || 0 : 0;
                try { controller.abort(); } catch (e) {}
                finish(length);
            })['catch'](function () { finish(0); });
        }

        var xhr = new XMLHttpRequest();
        try {
            xhr.open('GET', url, true);
            xhr.onreadystatechange = function () {
                if (xhr.readyState < 2) return;
                var length = xhr.status >= 200 && xhr.status < 400 ? parseInt(xhr.getResponseHeader('Content-Length'), 10) || 0 : 0;
                try { xhr.abort(); } catch (e) {}
                finish(length);
            };
            xhr.onerror = function () { finish(0); };
            xhr.send();
        } catch (e) {
            finish(0);
        }
    }

    function isPlaylist(bytes) {
        var head = bytesText(bytes, 16);
        return head.indexOf('#EXTM3U') === 0 || head.indexOf('#EXTM3U') === 3;
    }

    function looksLikeHtml(res) {
        return /text\/html/i.test(res.type) || /^\s*</.test(bytesText(res.bytes, 32));
    }

    function attr(line, name) {
        var match = line.match(new RegExp(name + '=("([^"]*)"|[^,]*)'));
        return match ? (match[2] !== undefined ? match[2] : match[1]) : '';
    }

    // Из мастер-плейлиста — лучший вариант: по размеру кадра, а если он не
    // указан, по битрейту. Раньше брался первый, а первым часто идёт 360p.
    function bestVariant(lines, base) {
        var best = null;

        for (var i = 0; i < lines.length; i++) {
            if (lines[i].indexOf('#EXT-X-STREAM-INF') !== 0) continue;

            var uri = '';
            for (var j = i + 1; j < lines.length && !uri; j++) {
                if (lines[j] && lines[j].charAt(0) !== '#') uri = lines[j];
            }
            if (!uri) continue;

            var res = attr(lines[i], 'RESOLUTION').split('x');
            var variant = {
                url: resolveUrl(base, uri),
                size: res.length === 2 ? { width: parseInt(res[0], 10) || 0, height: parseInt(res[1], 10) || 0 } : null,
                bandwidth: parseInt(attr(lines[i], 'BANDWIDTH'), 10) || 0
            };
            var pixels = variant.size ? variant.size.width * variant.size.height : 0;
            var best_pixels = best && best.size ? best.size.width * best.size.height : 0;

            if (!best || pixels > best_pixels || (pixels === best_pixels && variant.bandwidth > best.bandwidth)) best = variant;
        }

        return best;
    }

    // Видео действительно отдаётся, и какого оно размера. У HLS доходим до
    // первого сегмента (и init-сегмента у fMP4), у файла смотрим первые
    // байты. Пустой ответ или html вместо видео — провал: так выглядят и
    // мёртвый CDN, и страница с капчей.
    // Битрейт считаем сами: объём сегмента на его длительность из
    // плейлиста, у файла — полный размер на длительность фильма. Объём —
    // из Content-Length, скачивать ради него сегмент целиком не нужно.
    // done({ ok, size, claimed, bitrate, claimed_bitrate }): size и bitrate
    // — измеренные (или null), claimed — что написано в плейлисте.
    // hint.runtime — длительность в секундах из TMDB, если в самом файле
    // её не найти.
    function checkStream(url, done, depth, claimed, hint) {
        depth = depth || 0;
        claimed = claimed || {};
        hint = hint || {};

        function finish(size, bitrate) {
            done({
                ok: true,
                size: size,
                claimed: claimed.size || null,
                bitrate: bitrate > 0 ? Math.round(bitrate) : 0,
                claimed_bitrate: claimed.bandwidth || 0
            });
        }

        peek(url, 131072, function (res) {
            if (!res || !res.bytes.length) return done({ ok: false });

            if (isPlaylist(res.bytes)) {
                if (depth > 3) return done({ ok: false });

                var lines = bytesText(res.bytes).split(/\r?\n/).map(function (l) { return l.trim(); });
                // Последняя строка может быть оборвана
                if (res.cut) lines.pop();

                var variant = bestVariant(lines, res.url);
                if (variant) {
                    return checkStream(variant.url, done, depth + 1, {
                        size: variant.size || claimed.size,
                        bandwidth: variant.bandwidth || claimed.bandwidth
                    }, hint);
                }

                var map = lines.filter(function (l) { return l.indexOf('#EXT-X-MAP') === 0; })[0];
                var segments = [];
                for (var i = 0; i < lines.length; i++) {
                    if (lines[i] && lines[i].charAt(0) !== '#') segments.push(i);
                }
                if (!segments.length) return done({ ok: false });

                // Длительность и, если есть, байтовый диапазон сегмента
                function segmentInfo(index) {
                    var info = { url: resolveUrl(res.url, lines[index]), duration: 0, range: 0 };

                    for (var k = index - 1; k >= 0 && lines[k].charAt(0) === '#'; k--) {
                        if (lines[k].indexOf('#EXTINF:') === 0) info.duration = parseFloat(lines[k].slice(8)) || 0;
                        if (lines[k].indexOf('#EXT-X-BYTERANGE:') === 0) info.range = parseInt(lines[k].slice(17), 10) || 0;
                        if (lines[k].indexOf('#EXTM3U') === 0 || lines[k].indexOf('#EXTINF:') === 0) break;
                    }

                    return info;
                }

                // Битрейт — по нескольким сегментам, разбросанным по
                // плейлисту: один сегмент врёт в разы в зависимости от сцены,
                // а в начале фильма и вовсе заставка. Объём берём из
                // заголовков, сами сегменты не качаем.
                var sample = [];
                var picks = segments.length > 5 ? [0.1, 0.3, 0.5, 0.7, 0.9] : [0];
                picks.forEach(function (at) {
                    var index = segments[Math.min(segments.length - 1, Math.floor(segments.length * at))];
                    if (sample.indexOf(index) === -1) sample.push(index);
                });

                var first = segmentInfo(segments[0]);
                var init = map && attr(map, 'URI');

                // Всё сразу, параллельно: первый сегмент (из него разрешение —
                // он начинается с ключевого кадра, а значит, и с заголовка
                // кодека), init-сегмент fMP4 и заголовки сегментов для
                // битрейта. По очереди это были бы лишние секунды на каждый
                // источник.
                var pending = 1 + sample.length + (init ? 1 : 0);
                var failed = false;
                var size = null;
                var init_size = null;
                var bytes = 0;
                var seconds = 0;

                function part() {
                    if (--pending || failed) return;
                    finish(size || init_size, seconds ? bytes * 8 / seconds : 0);
                }

                peek(first.url, 131072, function (seg) {
                    if (!seg || seg.bytes.length < 1024 || looksLikeHtml(seg)) {
                        failed = true;
                        return done({ ok: false });
                    }
                    size = videoSize(seg.bytes);
                    part();
                });

                if (init) {
                    peek(resolveUrl(res.url, init), 131072, function (head) {
                        init_size = head ? mp4Size(head.bytes) : null;
                        part();
                    });
                }

                sample.forEach(function (index) {
                    var info = segmentInfo(index);

                    function add(length) {
                        if (length > 0 && info.duration > 0.5) {
                            bytes += length;
                            seconds += info.duration;
                        }
                        part();
                    }

                    if (info.range) return add(info.range);
                    headLength(info.url, add);
                });

                return;
            }

            if (res.bytes.length < 1024 || looksLikeHtml(res)) return done({ ok: false });

            var seconds = mp4Duration(res.bytes) || hint.runtime || 0;
            finish(videoSize(res.bytes), seconds > 60 && res.length ? res.length * 8 / seconds : 0);
        });
    }

    // Ответ Lampac (html) или прямого источника ({ items, buttons }) —
    // в одном виде
    function splitBody(body) {
        var json = typeof body === 'object' ? body : Lampa.Arrays.decodeJson(body, null);
        var result = { json: json, items: [], buttons: [] };

        if (json && Array.isArray(json.items)) {
            result.items = json.items;
            result.buttons = json.buttons || [];
        } else if (typeof body === 'string' && body.indexOf('videos__') !== -1) {
            var html = $('<div>' + body + '</div>');
            result.items = parseElements(html, '.videos__item');
            result.buttons = parseElements(html, '.videos__button');
        }

        return result;
    }

    // ------------------------------------------------------------- компонент

    function OnlineComponent(object) {
        var movie = object.movie;
        var serial = object.method === 'tv' || (!object.method && Core.cardMethod(movie) === 'tv');

        var network = new Lampa.Reguest();
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var files = new Lampa.Explorer(object);
        var filter = new Lampa.Filter(object);

        // Балансеры со всех серверов. Ключ — «сервер|балансер»: одно и то же
        // имя на двух серверах — это два разных источника с разной выдачей.
        var sources = {};
        var order = [];
        var active = '';
        var auto_picked = false;
        var tried = {};

        // Проверка источников: key → 'queue' | 'run' | 'ok' | 'fail'.
        // Рабочему запоминается, где нашлось видео, — страница серий и
        // список сезонов, — чтобы открыть его сразу, не проходя путь заново.
        var checks = {};
        var verified = {};
        var check_queue = [];
        var check_running = 0;
        var check_nets = [];
        var pick_timer = null;
        var settled = 0;
        var messages = [];
        var pollers = [];
        var timers = [];

        var voices = [];
        var seasons = [];
        var redirected = {};
        var rch_retried = {};
        var last_url = '';
        var requests = 0;
        var requests_timer;

        var last;
        var images = [];
        var initialized = false;
        var destroyed = false;
        var self = this;

        // ----- что человек выбирал в прошлый раз

        function movieKey() {
            return (movie.source || 'tmdb') + ':' + movie.id;
        }

        function loadChoice() {
            var all = Lampa.Storage.cache(CHOICE_KEY, 3000, {});
            var choice = all[movieKey()] || {};

            if (!choice.per) choice.per = {};
            return choice;
        }

        function saveChoice(change) {
            var all = Lampa.Storage.cache(CHOICE_KEY, 3000, {});
            var choice = all[movieKey()] || { per: {} };

            if (!choice.per) choice.per = {};
            change(choice);
            all[movieKey()] = choice;
            Lampa.Storage.set(CHOICE_KEY, all);
        }

        function sourceChoice() {
            return loadChoice().per[active] || {};
        }

        function saveSourceChoice(values) {
            saveChoice(function (choice) {
                var per = choice.per[active] || {};
                Object.keys(values).forEach(function (name) { per[name] = values[name]; });
                choice.per[active] = per;
            });
        }

        // ----- запросы

        function requestParams(url) {
            var year = String(movie.release_date || movie.first_air_date || '0000').slice(0, 4);
            var anime = movie.keywords && movie.keywords.results && movie.keywords.results.some(function (k) {
                return k.name === 'anime';
            });
            var title = object.clarification ? object.search : (movie.title || movie.name);

            var query = [
                'id=' + encodeURIComponent(movie.id),
                'title=' + encodeURIComponent(title || ''),
                'original_title=' + encodeURIComponent(movie.original_title || movie.original_name || ''),
                'serial=' + (serial ? 1 : 0),
                'original_language=' + encodeURIComponent(movie.original_language || ''),
                'year=' + year,
                'source=' + encodeURIComponent(movie.source || 'tmdb'),
                'clarification=' + (object.clarification ? 1 : 0),
                'similar=' + (object.similar ? 'true' : 'false'),
                'rchtype=' + (rch_kind || '')
            ];

            if (movie.imdb_id) query.push('imdb_id=' + encodeURIComponent(movie.imdb_id));
            if (movie.kinopoisk_id) query.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id));
            if (movie.tmdb_id) query.push('tmdb_id=' + encodeURIComponent(movie.tmdb_id));
            if (anime) query.push('anime=1');

            var email = Lampa.Storage.get('account_email', '');
            if (email) query.push('cub_id=' + Lampa.Utils.hash(email));

            return url + (url.indexOf('?') >= 0 ? '&' : '?') + query.join('&');
        }

        // Балансеры ищут по imdb и Кинопоиску, а у карточки TMDB второго нет.
        // Сервер Lampac умеет его найти. Спрашиваем все серверы сразу и
        // берём первый ответ: по очереди один лежащий сервер съедал бы
        // секунды таймаута при каждом открытии.
        function externalIds(done) {
            var list = servers();
            var finished = false;
            var left = list.length;

            function finish() {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                done();
            }

            if ((movie.imdb_id && movie.kinopoisk_id) || !list.length) return done();

            var timer = setTimeout(finish, 4000);
            var query = ['id=' + encodeURIComponent(movie.id), 'serial=' + (serial ? 1 : 0)];
            if (movie.imdb_id) query.push('imdb_id=' + encodeURIComponent(movie.imdb_id));
            if (movie.kinopoisk_id) query.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id));

            list.forEach(function (host) {
                var ids = new Lampa.Reguest();
                ids.timeout(4000);
                ids.silent(account(host + 'externalids?' + query.join('&')), function (json) {
                    if (finished || destroyed) return;

                    if (json && typeof json === 'object') {
                        Object.keys(json).forEach(function (name) {
                            if (json[name]) movie[name] = json[name];
                        });
                    }
                    finish();
                }, function () {
                    if (!--left) finish();
                });
            });
        }

        // confirmed — балансер сам сказал, что фильм у него есть: так отвечает
        // опрос lifeevents. Сервер, отдавший список сразу, ничего не проверял,
        // и его балансеры могут оказаться пустыми.
        function addSources(host, list, confirmed) {
            var multi = servers().length > 1;
            var direct = host === 'direct:';
            // Прямые источники — после серверов
            var rank = direct ? servers().length : servers().indexOf(host);

            (list || []).forEach(function (item) {
                if (!item || !item.url) return;

                var name = String(item.balanser || String(item.name || '').split(' ')[0]).toLowerCase();
                var key = host + '|' + name;

                if (!sources[key]) order.push(key);

                sources[key] = {
                    key: key,
                    host: host,
                    balanser: name,
                    name: (item.name || name) + (multi && !direct ? ' · ' + serverLabel(host) : ''),
                    url: item.url,
                    show: item.show === undefined ? true : !!item.show,
                    confirmed: !!confirmed,
                    rank: rank,
                    at: sources[key] ? sources[key].at : order.length
                };
            });

            // Порядок источников — порядок серверов в настройках, а не то,
            // кто ответил первым
            order.sort(function (a, b) {
                return (sources[a].rank - sources[b].rank) || (sources[a].at - sources[b].at);
            });

            enqueueChecks();
        }

        // ----- проверка источников

        var CHECK_PARALLEL = 10;
        var PICK_GRACE = 2000;
        var MIN_QUALITY = 720;

        function preferredKeys() {
            var wanted = [loadChoice().source, Lampa.Storage.get(LAST_SOURCE_KEY, '')].filter(Boolean);
            var name = String(wanted[wanted.length - 1] || '').split('|')[1];

            order.forEach(function (key) {
                if (name && sources[key].balanser === name && wanted.indexOf(key) === -1) wanted.push(key);
            });

            return wanted.filter(function (key) { return sources[key]; });
        }

        function enqueueChecks() {
            var preferred = preferredKeys();

            order.forEach(function (key) {
                if (!sources[key].show || checks[key]) return;

                checks[key] = 'queue';
                check_queue.push(key);
            });

            // Первыми — тот, что человек выбирал, потом те, что сервер
            // проверил сам, и с самым высоким заявленным качеством: так
            // первый прошедший скорее всего и будет лучшим
            check_queue.sort(function (a, b) {
                return ((preferred.indexOf(b) !== -1) - (preferred.indexOf(a) !== -1)) ||
                    ((sources[b].confirmed ? 1 : 0) - (sources[a].confirmed ? 1 : 0)) ||
                    (nameQuality(sources[b].name) - nameQuality(sources[a].name)) ||
                    (order.indexOf(a) - order.indexOf(b));
            });

            runChecks();
        }

        function runChecks() {
            while (!destroyed && check_running < CHECK_PARALLEL && check_queue.length) {
                (function (key) {
                    check_running++;
                    checks[key] = 'run';

                    probe(key, function (result) {
                        check_running--;
                        if (destroyed) return;

                        // Ниже 720p не показываем вовсе. Качество, которое не
                        // удалось узнать ни из видео, ни от балансера, не
                        // повод выкидывать рабочий источник.
                        if (result && result.quality && result.quality < MIN_QUALITY) {
                            checks[key] = 'low';
                            result = null;
                        }

                        if (!checks[key] || checks[key] === 'run') checks[key] = result ? 'ok' : 'fail';
                        if (result) verified[key] = result;

                        saveChecks();
                        updateSort();
                        pick();
                        runChecks();
                    });
                })(check_queue.shift());
            }

            updateProgress();
        }

        // ----- кэш проверки

        function loadChecks() {
            var all = Lampa.Storage.get(CHECKS_KEY, '{}') || {};
            var saved = all[movieKey()];

            if (!saved || Date.now() - saved.at > CHECKS_TTL || !saved.items) return false;

            var any = false;

            Object.keys(saved.items).forEach(function (key) {
                var item = saved.items[key];
                if (!item || !item.source) return;

                sources[key] = item.source;
                if (order.indexOf(key) === -1) order.push(key);

                checks[key] = item.state;
                if (item.state === 'ok' && item.info) {
                    item.info.cached = true;
                    verified[key] = item.info;
                    any = true;
                }
            });

            order.sort(function (a, b) {
                return (sources[a].rank - sources[b].rank) || (sources[a].at - sources[b].at);
            });

            return any;
        }

        var save_timer;

        function saveChecks() {
            clearTimeout(save_timer);
            save_timer = setTimeout(function () {
                var items = {};

                Object.keys(checks).forEach(function (key) {
                    var state = checks[key];
                    if (state !== 'ok' && state !== 'fail' && state !== 'low') return;
                    items[key] = { state: state, source: sources[key], info: verified[key] || null };
                });

                var all = Lampa.Storage.get(CHECKS_KEY, '{}') || {};
                all[movieKey()] = { at: Date.now(), items: items };

                // Держим только последние фильмы, иначе хранилище разрастётся
                var keys = Object.keys(all).sort(function (a, b) { return (all[b].at || 0) - (all[a].at || 0); });
                keys.slice(CHECKS_KEEP).forEach(function (k) { delete all[k]; });

                Lampa.Storage.set(CHECKS_KEY, all);
            }, 500);
        }

        function checkCounts() {
            var counts = { total: 0, done: 0, ok: 0 };

            Object.keys(checks).forEach(function (key) {
                counts.total++;
                if (checks[key] === 'ok' || checks[key] === 'fail' || checks[key] === 'low') counts.done++;
                if (checks[key] === 'low') counts.low = (counts.low || 0) + 1;
                if (checks[key] === 'ok') counts.ok++;
            });

            return counts;
        }

        function checksBusy() {
            return settled < totalProviders() || check_running > 0 || check_queue.length > 0;
        }

        function updateProgress() {
            if (sources_open) refreshSources();

            var counts = checkCounts();
            var loader = filter.render().find('.online-parser-loader');

            if (checksBusy()) {
                if (!loader.length) filter.render().find('.filter--sort').append('<span class="online-parser-loader"></span>');
            } else {
                loader.remove();
            }

            if (!active) {
                scroll.render().find('.online-parser-progress').text(
                    'Проверяю источники: ' + counts.done + ' из ' + counts.total + (counts.ok ? ', рабочих ' + counts.ok : '')
                );
            }
        }

        // Проходит источник так же, как прошёл бы человек: сезон, при
        // необходимости выбор тайтла из «похожих», серия, ссылка на поток —
        // и скачивает начало самого видео. done(null), если что-то сорвалось.
        function probe(key, done) {
            var net = new Lampa.Reguest();
            var steps = 0;
            var found_seasons = [];
            var watched = loadChoice().last || {};
            var year = Core.cardYear(movie);

            check_nets.push(net);

            function fetch(url, next) {
                if (/^direct:/.test(url)) {
                    return directRequest(url, directContext(), function (result) {
                        next(result ? splitBody(result) : null);
                    });
                }

                net.timeout(10000);
                net['native'](account(url), function (body) {
                    next(splitBody(body));
                }, function () {
                    next(null);
                }, false, { dataType: 'text' });
            }

            function step(url) {
                if (destroyed) return;
                if (++steps > 6) return done(null);

                fetch(url, function (page) {
                    if (destroyed) return;
                    if (!page) return done(null);

                    var json = page.json;
                    // rch и вход по аккаунту проверке не поддаются
                    if (json && typeof json === 'object' && !Array.isArray(json) && (json.rch || json.accsdb)) return done(null);

                    var videos = page.items.filter(function (i) { return i.method === 'play' || i.method === 'call'; });
                    var similar = page.items.filter(function (i) { return i.similar; });
                    var links = page.items.filter(function (i) { return i.method === 'link' && !i.similar; });

                    if (videos.length) return tryVideo(url, videos);

                    if (links.length) {
                        found_seasons = links.map(function (i) { return { title: i.text, url: i.url }; });
                        var season = found_seasons.filter(function (s) { return watched.season && seasonNumber(s.title) === watched.season; })[0] ||
                            found_seasons.filter(function (s) { return seasonNumber(s.title) !== 0; })[0] ||
                            found_seasons[0];
                        return step(season.url);
                    }

                    if (similar.length) {
                        var same_year = similar.filter(function (i) {
                            return year && String(i.year || i.start_date || '').slice(0, 4) === String(year);
                        })[0];
                        return step((same_year || similar[0]).url);
                    }

                    done(null);
                });
            }

            function tryVideo(page_url, videos) {
                var target = videos.filter(function (v) {
                    return watched.episode && v.episode === watched.episode && (!v.season || v.season === watched.season);
                })[0] || videos[0];

                function verify(stream) {
                    if (!stream || !stream.url) return done(null);
                    // Внешний плеер заголовки не передаст — такой поток у
                    // него не откроется
                    if (external() && stream.headers && Object.keys(stream.headers).length) return done(null);

                    // Проверяем лучшее из заявленных качеств: его и будем
                    // замерять. Не открылось — пробуем то, что включится по
                    // умолчанию.
                    var links = qualityLinks(stream);
                    var fallback = streamFor(stream).url;
                    if (fallback && links.indexOf(fallback) === -1) links.push(fallback);
                    if (!links.length) return done(null);

                    (function next(i) {
                        if (i >= links.length) return done(null);

                        checkStream(links[i], function (res) {
                            if (destroyed) return;
                            if (!res.ok) return next(i + 1);

                            var measured = qualityClass(res.size);
                            var said = res.claimed ? qualityClass(res.claimed) : claimedQuality(stream, links[i]) || nameQuality(sources[key].name);

                            done({
                                bitrate: res.bitrate || res.claimed_bitrate,
                                bitrate_measured: !!res.bitrate,
                                page: page_url,
                                seasons: found_seasons,
                                episodes: serial ? videos.length : 0,
                                season: serial ? (videos[0].season || 0) : 0,
                                quality: measured || said,
                                measured: !!measured,
                                size: res.size
                            });
                        }, 0, null, { runtime: runtimeSeconds() });
                    })(0);
                }

                if (target.method === 'play') return verify(target);

                net.timeout(10000);
                net.silent(account(target.url), function (json) {
                    verify(json && !json.rch ? json : null);
                }, function () {
                    done(null);
                });
            }

            step(/^direct:/.test(sources[key].url) ? sources[key].url : requestParams(sources[key].url));
        }

        function loadServer(host, done) {
            var net = new Lampa.Reguest();
            var polls = 0;
            var finished = false;

            pollers.push(net);

            function finish() {
                if (finished) return;
                finished = true;
                done();
            }

            function poll(memkey) {
                if (destroyed) return;

                net.timeout(4000);
                net.silent(account(requestParams(host + 'lifeevents?memkey=' + encodeURIComponent(memkey))), function (json) {
                    polls++;

                    if (json && json.accsdb) {
                        messages.push(json.msg);
                        return finish();
                    }

                    addSources(host, json && json.online, true);
                    updateSort();
                    pick();

                    if ((json && json.ready) || polls >= LIFE_POLLS) finish();
                    else timers.push(setTimeout(function () { poll(memkey); }, LIFE_INTERVAL));
                }, function () {
                    polls++;
                    if (polls >= LIFE_POLLS) finish();
                    else timers.push(setTimeout(function () { poll(memkey); }, LIFE_INTERVAL));
                });
            }

            net.timeout(10000);
            net.silent(account(requestParams(host + 'lite/events?life=true')), function (json) {
                if (json && json.accsdb) {
                    messages.push(json.msg);
                    return finish();
                }

                if (Array.isArray(json)) {
                    addSources(host, json, false);
                    updateSort();
                    return finish();
                }

                if (json && json.life && json.memkey) return poll(json.memkey);

                finish();
            }, function () {
                messages.push('Сервер ' + serverLabel(host) + ' не отвечает');
                finish();
            });
        }

        function loadSources() {
            var list = servers();

            if (!list.length) {
                return message('Нет серверов', 'Впишите адрес сервера Lampac в настройках → «Онлайн».');
            }

            updateProgress();

            var direct = Object.keys(DIRECT).filter(function (id) { return DIRECT[id].match(movie); });
            var total = totalProviders();

            function settle() {
                settled++;

                if (settled === total) {
                    updateProgress();
                    pick();
                }
            }

            list.forEach(function (host) {
                loadServer(host, settle);
            });

            direct.forEach(function (id) {
                DIRECT[id].search(directContext(), function (found) {
                    if (destroyed) return;

                    addSources('direct:', [{ name: DIRECT[id].name, balanser: id, url: 'direct:' + id + ':search', show: found }], true);
                    updateSort();
                    settle();
                });
            });
        }

        function totalProviders() {
            return servers().length + Object.keys(DIRECT).filter(function (id) { return DIRECT[id].match(movie); }).length;
        }

        // Прямым источникам нужно то же, что серверу: карточка, тип и
        // уточнённое название. Сюда же они складывают найденное, чтобы не
        // искать второй раз при открытии.
        var direct_context = null;

        function directContext() {
            if (!direct_context) {
                direct_context = { movie: movie, serial: serial, search: object.clarification ? object.search : '' };
            }
            return direct_context;
        }

        // Открываем только проверенное. Тот, что смотрели в этом фильме или
        // выбирали последним, — как только он прошёл проверку; пока он ещё
        // проверяется, ждём его. Иначе — первый рабочий, не дожидаясь
        // остальных: список дополнится сам.
        function pick() {
            // Человек сам выбирает в «Источнике» — не перебиваем его
            if (active || destroyed || sources_open) return;

            var preferred = preferredKeys();

            for (var i = 0; i < preferred.length; i++) {
                var state = checks[preferred[i]];
                if (state === 'ok') return open(preferred[i], true);
                if (state === 'queue' || state === 'run') return;
            }

            var first = nextCandidate();

            // Проверено в прошлый раз — открываем сразу, ждать нечего
            if (first && verified[first].cached && !partial(first)) return open(first, true);

            // Неполный сериал открываем, только когда ждать больше некого
            if (first && partial(first) && checksBusy()) return;

            if (first) {
                // Первым отвечает не лучший, а самый быстрый. Даём остальным
                // пару секунд и открываем лучший по порядку из прошедших.
                if (!checksBusy()) return open(first, true);
                if (!pick_timer) {
                    pick_timer = setTimeout(function () {
                        pick_timer = null;
                        var best = nextCandidate();
                        if (!best || active || sources_open) return;
                        if (partial(best) && checksBusy()) return;
                        open(best, true);
                    }, PICK_GRACE);
                    timers.push(pick_timer);
                }
                return;
            }

            if (checksBusy()) return;

            var counts = checkCounts();
            if (messages.length && !counts.total) return message('Ничего не нашлось', messages.join('<br>'));

            message('Рабочих источников нет',
                counts.total
                    ? 'Проверено ' + counts.total + ' — ни один не отдал видео в 720p и выше' +
                        (counts.low ? ' (в худшем качестве — ' + counts.low + ')' : '') +
                        '. Попробуйте уточнить название через поиск или зайти позже.'
                    : 'Ни один балансер не знает этот фильм. Попробуйте уточнить название через поиск.',
                true);
        }

        // Длительность в секундах из TMDB — для битрейта файла, у которого
        // её нет в заголовке. У сериала — средняя длина серии.
        function runtimeSeconds() {
            var minutes = serial
                ? (movie.episode_run_time && movie.episode_run_time[0]) || (movie.last_episode_to_air && movie.last_episode_to_air.runtime)
                : movie.runtime;
            return (parseInt(minutes, 10) || 0) * 60;
        }

        function bitrateName(bits) {
            return bits ? (bits / 1e6).toFixed(bits >= 1e7 ? 0 : 1) + ' mbps' : '';
        }

        // Ссылки из карты качеств, лучшая первой
        function qualityLinks(stream) {
            var map = stream.quality && typeof stream.quality === 'object' ? stream.quality : {};

            return Object.keys(map).sort(function (a, b) {
                return qualityNumber(b) - qualityNumber(a);
            }).map(function (name) {
                return splitReserve(map[name]).url;
            }).filter(Boolean);
        }

        function claimedQuality(stream, link) {
            var map = stream.quality && typeof stream.quality === 'object' ? stream.quality : {};
            var name = Object.keys(map).filter(function (q) { return splitReserve(map[q]).url === link; })[0];
            return qualityNumber(name || stream.maxquality || '');
        }

        // Качество, которое балансер вписал себе в название: «Kodik ~ 720p»
        function nameQuality(name) {
            var match = String(name || '').match(/(\d{3,4})p|\b4K\b/i);
            return match ? (match[1] ? parseInt(match[1], 10) : 2160) : 0;
        }

        // Следующий рабочий, кого ещё не открывали
        function nextCandidate() {
            return workingOrder().filter(function (key) { return !tried[key]; })[0];
        }

        // Рабочие по порядку: сначала на русском, балансеры с другим языком
        // озвучки — в конце. Их Lampac подписывает прямо в названии.
        function foreign(key) {
            return /\((Украинский|Грузинский|ENG|English|Казахский|Армянский)\)/i.test(sources[key].name);
        }

        // Внутри каждой группы — по настоящему разрешению, лучшее сверху,
        // внутри одного разрешения — по битрейту. При равенстве — порядок
        // серверов.
        function workingOrder() {
            var working = order.filter(function (key) { return checks[key] === 'ok'; });

            function byQuality(a, b) {
                var pa = partial(a) ? 1 : 0;
                var pb = partial(b) ? 1 : 0;
                if (pa !== pb) return pa - pb;

                var qa = verified[a] || {};
                var qb = verified[b] || {};
                return ((qb.quality || 0) - (qa.quality || 0)) ||
                    ((qb.bitrate || 0) - (qa.bitrate || 0)) ||
                    ((qb.measured ? 1 : 0) - (qa.measured ? 1 : 0)) ||
                    (order.indexOf(a) - order.indexOf(b));
            }

            return working.filter(function (key) { return !foreign(key); }).sort(byQuality)
                .concat(working.filter(foreign).sort(byQuality));
        }

        // У сериала источник, где серий заметно меньше, чем у лучшего, —
        // неполный: в 1080p, но с одной серией он не нужен наверху
        function partial(key) {
            if (!serial || !verified[key]) return false;

            var most = aired(verified[key].season);
            Object.keys(verified).forEach(function (k) {
                if (checks[k] === 'ok') most = Math.max(most, verified[k].episodes || 0);
            });

            return (verified[key].episodes || 0) < most * 0.8;
        }

        // Сколько серий сезона уже вышло, по данным TMDB в карточке
        function aired(season) {
            if (!season) return 0;

            var last = movie.last_episode_to_air;
            if (last && last.season_number === season) return last.episode_number || 0;

            var info = (movie.seasons || []).filter(function (s) { return s.season_number === season; })[0];
            return info ? info.episode_count || 0 : 0;
        }

        // Название без того качества, что балансер написал про себя, и с
        // тем, что оказалось на деле. Не измерилось — заявленное со знаком
        // вопроса.
        function sourceTitle(key) {
            var name = sources[key].name.replace(/\s*[~\-–]\s*(\d{3,4}p|4K)(?=\s|$)/i, '');
            var info = verified[key];

            if (!info) return name;

            var parts = [];
            parts.push(info.quality ? qualityName(info.quality) + (info.measured ? '' : '?') : 'качество ?');
            if (info.bitrate) parts.push(bitrateName(info.bitrate) + (info.bitrate_measured ? '' : '?'));
            if (partial(key)) parts.push(info.episodes + ' сер.');

            return parts.length ? name + ' — ' + parts.join(', ') : name;
        }

        function open(key, auto) {
            active = key;
            auto_picked = !!auto;
            tried[key] = true;
            voices = [];
            seasons = [];
            redirected = {};

            saveChoice(function (choice) { choice.source = key; });
            if (!auto) Lampa.Storage.set(LAST_SOURCE_KEY, key);

            updateSort();
            updateFilter();
            reset();

            if (verified[key]) {
                seasons = verified[key].seasons.slice();
                return request(verified[key].page);
            }

            request(/^direct:/.test(sources[key].url) ? sources[key].url : requestParams(sources[key].url));
        }

        function request(url) {
            if (destroyed) return;

            // Сервер может отдавать ссылки, ведущие по кругу, — не даём
            // крутиться бесконечно.
            requests++;
            clearTimeout(requests_timer);
            requests_timer = setTimeout(function () { requests = 0; }, 4000);
            if (requests > 10) return message('Балансер зациклился', 'Выберите другой источник.', false, true);

            last_url = url;

            if (/^direct:/.test(url)) {
                return directRequest(url, directContext(), function (result) {
                    if (destroyed || last_url !== url) return;
                    if (!result) return doesNotAnswer();
                    parse(result);
                });
            }

            network.clear();
            network.timeout(20000);
            network['native'](account(url), parse, function () {
                doesNotAnswer();
            }, false, { dataType: 'text' });
        }

        function parse(body) {
            if (destroyed) return;

            var json = typeof body === 'object' ? body : Lampa.Arrays.decodeJson(body, null);

            if (json && typeof json === 'object' && !Array.isArray(json)) {
                if (json.accsdb) return message('Нужен вход', escapeHtml(json.msg || ''), false, true);
                if (json.rch) return remoteClient(json, function () { request(last_url); });
            }

            var split = splitBody(body);
            var items = split.items;
            var buttons = split.buttons;

            var videos = items.filter(function (item) {
                return item.method === 'play' || item.method === 'call';
            });
            var similar = items.filter(function (item) { return item.similar; });
            var links = items.filter(function (item) { return item.method === 'link' && !item.similar; });

            if (videos.length) {
                voices = buttons.map(function (button) {
                    return { title: button.text, url: button.url, active: button.active };
                });

                if (voices.length && switchVoice()) return;

                return display(videos);
            }

            if (similar.length) return showSimilar(similar);

            if (links.length) {
                seasons = links.map(function (item) { return { title: item.text, url: item.url }; });
                updateFilter();

                return request(currentSeason().url);
            }

            doesNotAnswer();
        }

        // Сезон, который открыть: выбранный здесь раньше, иначе тот, где
        // человек смотрел последнюю серию, иначе первый настоящий. У аниме
        // балансеры первым ставят «0 сезон» — спецвыпуски, открывать его по
        // умолчанию значит показать не то.
        function seasonNumber(title) {
            var match = String(title || '').match(/^\s*(\d+)/);
            return match ? parseInt(match[1], 10) : null;
        }

        function currentSeason() {
            var saved = sourceChoice().season;
            var watched = (loadChoice().last || {}).season;

            return seasons.filter(function (s) { return saved && s.title === saved; })[0] ||
                seasons.filter(function (s) { return watched && seasonNumber(s.title) === watched; })[0] ||
                seasons.filter(function (s) { return seasonNumber(s.title) !== 0; })[0] ||
                seasons[0];
        }

        // Балансер открывается на своей озвучке по умолчанию. Если человек
        // уже выбирал другую — здесь или на другом балансере — переходим на
        // неё: сначала по ссылке, потом по названию. Один раз на ссылку, иначе
        // сервер, не отмечающий активную кнопку, загонит нас в цикл.
        function switchVoice() {
            var choice = sourceChoice();
            var wanted_name = choice.voice || loadChoice().voice;
            var target = voices.filter(function (v) { return choice.voice_url && v.url === choice.voice_url; })[0] ||
                voices.filter(function (v) { return wanted_name && v.title === wanted_name; })[0];

            if (target && !target.active && !redirected[target.url]) {
                redirected[target.url] = true;
                request(target.url);
                return true;
            }

            return false;
        }

        function remoteClient(json, retry) {
            var host = hostOf(json.nws ? json.nws.replace(/^ws/i, 'http') : last_url) || hostOf(last_url);

            if (!rchEnabled()) {
                return message('Нужны запросы с устройства',
                    'Этот балансер качает страницы через ваше устройство. Включите «Запросы сервера с устройства» в настройках → «Онлайн» или выберите другой источник.',
                    false, true);
            }

            // Уже переподключались ради этой ссылки, а сервер опять просит —
            // значит, через устройство балансер тоже не открылся.
            if (rch_retried[last_url]) return doesNotAnswer();
            rch_retried[last_url] = true;

            rchConnect(host, json.nws, function (ok) {
                if (destroyed) return;
                if (!ok) return doesNotAnswer();

                retry();
            });
        }

        // ----- отрисовка

        function reset() {
            last = null;
            network.clear();
            clearImages();
            scroll.clear();
            scroll.reset();
            scroll.body().append(Lampa.Template.get('online_parser_loading'));
        }

        function clearImages() {
            images.forEach(function (img) {
                img.onerror = function () {};
                img.onload = function () {};
                img.src = '';
            });
            images = [];
        }

        function message(title, text, with_search, with_sources) {
            var html = Lampa.Template.get('online_parser_message', { title: title, text: '' });
            var buttons = html.find('.online-parser-empty__buttons');

            html.find('.online-parser-empty__text').html(text || '');

            function addButton(label, action) {
                var button = $('<div class="online-parser-empty__button selector"></div>').text(label);
                button.on('hover:enter', action);
                buttons.append(button);
            }

            if (with_sources && order.length > 1) {
                addButton('Другой источник', function () {
                    filter.render().find('.filter--sort').trigger('hover:enter');
                });
            }

            if (with_search !== false) {
                addButton('Уточнить название', function () {
                    filter.render().find('.filter--search').trigger('hover:enter');
                });
            }

            scroll.clear();
            scroll.append(html);
            self.loading(false);
            Lampa.Controller.enable('content');
        }

        function doesNotAnswer() {
            var name = sources[active] ? sources[active].name : 'Балансер';

            // Балансер выбрали за человека — значит, и следующий выберем сами,
            // а не бросим его на пустом экране.
            var next = auto_picked && nextCandidate();
            if (next) {
                Lampa.Noty.show(name + ': пусто, пробую ' + sources[next].name);
                return open(next, true);
            }

            message(escapeHtml(name), 'Ничего не нашёл или не ответил. Попробуйте другой источник или уточните название.', true, true);
        }

        function getEpisodes(season, done) {
            var tmdb_id = ['cub', 'tmdb'].indexOf(movie.source || 'tmdb') === -1 ? movie.tmdb_id : movie.id;

            if (!serial || !season || !tmdb_id || !Lampa.Api.sources.tmdb) return done([]);

            Lampa.Api.sources.tmdb.get('tv/' + tmdb_id + '/season/' + season, {}, function (data) {
                done((data && data.episodes) || []);
            }, function () {
                done([]);
            });
        }

        // Хэши посчитаны так же, как у всех клиентов Lampac: таймлайн — по
        // серии и оригинальному названию, отметка «просмотрено» — ещё и по
        // озвучке.
        function hashes(element, voice) {
            var title = movie.original_title || movie.original_name || movie.title || movie.name;

            if (element.season) {
                var base = [element.season, element.season > 10 ? ':' : '', element.episode, title];
                return {
                    timeline: Lampa.Utils.hash(base.join('')),
                    viewed: Lampa.Utils.hash(base.concat([voice]).join(''))
                };
            }

            return {
                timeline: Lampa.Utils.hash(title),
                viewed: Lampa.Utils.hash(title + voice)
            };
        }

        function viewedList() {
            return Lampa.Storage.cache(VIEWED_KEY, 5000, []);
        }

        function info(parts) {
            return parts.filter(Boolean).map(function (part) {
                return '<span>' + part + '</span>';
            }).join('<span class="online-parser__split">●</span>');
        }

        // У серии — качество, измеренное проверкой источника, а не то, что
        // написал балансер
        function qualityLabel(element) {
            var info = verified[active];
            if (info && info.quality) {
                return qualityName(info.quality) + (info.measured ? '' : '?') +
                    (info.bitrate ? ' · ' + bitrateName(info.bitrate) + (info.bitrate_measured ? '' : '?') : '');
            }
            if (element.maxquality) return element.maxquality + (/\d$/.test(element.maxquality) ? 'p' : '');
            if (element.quality && typeof element.quality === 'object') return Object.keys(element.quality)[0] || '';
            return '';
        }

        function display(videos) {
            updateFilter();

            var season_number = videos[0].season;

            getEpisodes(season_number, function (episodes) {
                if (destroyed) return;

                var voice_active = voices.filter(function (v) { return v.active; })[0];
                var voice = voice_active ? voice_active.title : '';
                var choice = sourceChoice();
                var watched = loadChoice().last || {};
                var focus = null;
                var max_episode = 0;

                if (voice) saveSourceChoice({ voice: voice, voice_url: voice_active.url });

                scroll.clear();
                scroll.reset();

                videos.forEach(function (element, index) {
                    var episode_number = element.episode || index + 1;
                    var tmdb = serial ? episodes.filter(function (e) { return e.episode_number === element.episode; })[0] : null;
                    var element_voice = voice || element.translate || element.voice_name || (serial ? '' : element.text) || '';
                    var hash = hashes(element, element_voice);
                    var viewed = viewedList().indexOf(hash.viewed) !== -1;

                    max_episode = Math.max(max_episode, episode_number);

                    element.voice_name = element_voice;
                    element.timeline = Lampa.Timeline.view(hash.timeline);

                    var title;
                    if (serial) title = (tmdb && tmdb.name) || element.text || ('Серия ' + episode_number);
                    else title = movie.title || movie.name || element.text;

                    var details = [];
                    if (tmdb && tmdb.air_date) details.push(Lampa.Utils.parseTime(tmdb.air_date).full);
                    if (!serial && element_voice !== title) details.push(escapeHtml(element_voice));
                    if (serial && element_voice) details.push(escapeHtml(element_voice));

                    var runtime = (tmdb && tmdb.runtime) || movie.runtime;

                    var html = Lampa.Template.get('online_parser_item', {
                        title: escapeHtml(title),
                        time: runtime ? Lampa.Utils.secondsToTime(runtime * 60, true) : '',
                        info: info(details),
                        quality: escapeHtml(qualityLabel(element))
                    });

                    var box = html.find('.online-parser__img');
                    var still = tmdb ? tmdb.still_path : movie.backdrop_path;

                    if (serial) box.append('<div class="online-parser__number">' + pad(episode_number) + '</div>');

                    if (still) {
                        var img = html.find('img')[0];
                        img.onload = function () { box.addClass('online-parser__img--loaded'); };
                        img.onerror = function () { img.removeAttribute('src'); };
                        img.src = Lampa.TMDB.image('t/p/w300' + still);
                        element.thumbnail = img.src;
                        images.push(img);
                    }

                    html.find('.online-parser__timeline').append(Lampa.Timeline.render(element.timeline));

                    function drawViewed(state) {
                        box.find('.online-parser__viewed').remove();
                        if (state) box.append('<div class="online-parser__viewed">' + VIEWED_ICON + '</div>');
                    }

                    drawViewed(viewed);

                    element.mark = function () {
                        var list = viewedList();
                        if (list.indexOf(hash.viewed) === -1) {
                            list.push(hash.viewed);
                            Lampa.Storage.set(VIEWED_KEY, list);
                        }
                        drawViewed(true);

                        saveChoice(function (c) {
                            c.voice = element_voice || c.voice;
                            c.last = { source: active, season: element.season || 0, episode: element.episode || 0, voice: element_voice };
                        });
                    };

                    element.unmark = function () {
                        var list = viewedList();
                        var at = list.indexOf(hash.viewed);
                        if (at !== -1) {
                            list.splice(at, 1);
                            Lampa.Storage.set(VIEWED_KEY, list);
                        }
                        drawViewed(false);
                    };

                    element.timeclear = function () {
                        element.timeline.percent = 0;
                        element.timeline.time = 0;
                        element.timeline.duration = 0;
                        Lampa.Timeline.update(element.timeline);
                    };

                    html.on('hover:enter', function () {
                        if (movie.id) Lampa.Favorite.add('history', movie, 100);
                        play(element, videos);
                    }).on('hover:focus', function (e) {
                        last = e.target;
                        scroll.update($(e.target), true);
                    }).on('hover:long', function () {
                        contextMenu(element, videos);
                    });

                    if (serial) {
                        if (watched.season === element.season && watched.episode === element.episode) focus = html;
                    } else if (viewed || (choice.voice && choice.voice === element_voice && !focus)) {
                        focus = html;
                    }

                    scroll.append(html);
                });

                // Серии, которых у балансера ещё нет, но TMDB про них знает, —
                // бледными, с датой выхода: видно, чего ждать.
                episodes.filter(function (e) { return e.episode_number > max_episode; }).forEach(function (episode) {
                    var html = Lampa.Template.get('online_parser_item', {
                        title: escapeHtml(episode.name || ('Серия ' + episode.episode_number)),
                        time: episode.runtime ? Lampa.Utils.secondsToTime(episode.runtime * 60, true) : '',
                        info: info([episode.air_date ? Lampa.Utils.parseTime(episode.air_date).full : '']),
                        quality: ''
                    });

                    html.addClass('online-parser--soon');
                    html.find('.online-parser__img').append('<div class="online-parser__number">' + pad(episode.episode_number) + '</div>');
                    html.on('hover:focus', function (e) {
                        last = e.target;
                        scroll.update($(e.target), true);
                    });
                    scroll.append(html);
                });

                if (focus) last = focus[0];

                self.loading(false);
                Lampa.Controller.enable('content');
            });
        }

        function showSimilar(list) {
            updateFilter();
            scroll.clear();
            scroll.reset();

            list.forEach(function (item) {
                var year = String(item.start_date || item.year || '').slice(0, 4);
                var html = Lampa.Template.get('online_parser_folder', {
                    title: escapeHtml(item.title || item.text),
                    time: escapeHtml(item.time || ''),
                    info: info([escapeHtml(year), escapeHtml(item.details || '')])
                });

                if (item.img) {
                    var src = item.img.charAt(0) === '/' ? sources[active].host + item.img.slice(1) : item.img;
                    if (src.indexOf('/proxyimg') !== -1) src = account(src);

                    var image = $('<img alt="">');
                    html.find('.online-parser__folder').empty().append(image);
                    Lampa.Utils.imgLoad(image, src);
                }

                html.on('hover:enter', function () {
                    reset();
                    voices = [];
                    seasons = [];
                    request(item.url);
                }).on('hover:focus', function (e) {
                    last = e.target;
                    scroll.update($(e.target), true);
                });

                scroll.append(html);
            });

            self.loading(false);
            Lampa.Controller.enable('content');
        }

        // ----- воспроизведение

        function resolve(element, done) {
            if (element.method === 'play') return done(element);

            var net = new Lampa.Reguest();

            Lampa.Loading.start(function () {
                net.clear();
                Lampa.Loading.stop();
                Lampa.Controller.toggle('content');
            });

            (function load(retried) {
                net.timeout(20000);
                net.silent(account(element.url), function (json) {
                    if (json && json.rch && !retried && rchEnabled()) {
                        return rchConnect(hostOf(element.url), json.nws, function (ok) {
                            if (ok) load(true);
                            else {
                                Lampa.Loading.stop();
                                done(null);
                            }
                        });
                    }

                    Lampa.Loading.stop();
                    done(json && json.url ? json : null);
                }, function () {
                    Lampa.Loading.stop();
                    done(null);
                });
            })(false);
        }

        // Качество по умолчанию — то, что выбрано в настройках плеера Lampa.
        function streamFor(stream) {
            var qualities = {};
            var preferred = parseInt(Lampa.Storage.field('video_quality_default'), 10);
            var main = splitReserve(stream.url);

            if (stream.quality && typeof stream.quality === 'object') {
                Object.keys(stream.quality).forEach(function (name) {
                    var link = splitReserve(stream.quality[name]);
                    qualities[name] = link.url;
                    if (preferred && parseInt(name, 10) === preferred) main = link;
                });
            }

            return {
                url: main.url,
                url_reserve: main.reserve,
                quality: Object.keys(qualities).length ? qualities : undefined
            };
        }

        function playItem(element, stream) {
            var picked = streamFor(stream);
            var title = movie.title || movie.name;

            if (serial && element.season) title += ' / S' + pad(element.season) + 'E' + pad(element.episode || 1);

            return {
                title: title,
                url: picked.url,
                url_reserve: picked.url_reserve || undefined,
                quality: picked.quality,
                headers: stream.headers,
                subtitles: stream.subtitles || element.subtitles,
                hls_manifest_timeout: stream.hls_manifest_timeout,
                timeline: element.timeline,
                season: element.season,
                episode: element.episode,
                voice_name: element.voice_name,
                thumbnail: element.thumbnail,
                callback: element.mark
            };
        }

        function external() {
            return Lampa.Storage.field('player') !== 'inner';
        }

        function play(element, videos) {
            resolve(element, function (stream) {
                if (!stream || !stream.url) return Lampa.Noty.show('Балансер не отдал ссылку на видео');

                var first = playItem(element, stream);
                var playlist = [];

                if (serial) {
                    videos.forEach(function (other) {
                        // В плейлист — копия, а не сам first: ему ниже
                        // достанется ссылка на плейлист, и получится кольцо.
                        // Внешний плеер Lampa сериализует всё в json и на
                        // кольце падает.
                        if (other === element) return playlist.push(playItem(element, stream));
                        if (other.method === 'play') return playlist.push(playItem(other, other));

                        // Внешний плеер получает плейлист json'ом и
                        // функцию-ссылку вызвать не сможет. Для него у
                        // балансера бывает готовая ссылка stream.
                        if (external() && other.stream) return playlist.push(playItem(other, { url: other.stream }));

                        // Ссылку на соседнюю серию балансер отдаёт только по
                        // запросу — просим её, когда плеер до неё дойдёт.
                        var cell = playItem(other, { url: '' });
                        cell.url = function (call) {
                            resolve(other, function (next) {
                                if (next && next.url) {
                                    var picked = playItem(other, next);
                                    Object.keys(picked).forEach(function (name) { cell[name] = picked[name]; });
                                    other.mark();
                                } else {
                                    cell.url = '';
                                    Lampa.Noty.show('Балансер не отдал ссылку на видео');
                                }
                                call();
                            });
                        };
                        playlist.push(cell);
                    });
                } else {
                    playlist.push(playItem(element, stream));
                }

                if (playlist.length > 1) first.playlist = playlist;

                Lampa.Player.play(first);
                Lampa.Player.playlist(playlist);

                if (first.subtitles_call) loadSubtitles(first.subtitles_call);

                element.mark();
                Lampa.Storage.set(LAST_SOURCE_KEY, active);
            });
        }

        function loadSubtitles(url) {
            var net = new Lampa.Reguest();
            net.silent(account(url), function (subs) {
                if (subs) Lampa.Player.subtitles(subs);
            }, function () {});
        }

        function copy(text) {
            Lampa.Utils.copyTextToClipboard(text, function () {
                Lampa.Noty.show('Ссылка скопирована');
            }, function () {
                Lampa.Noty.show('Не удалось скопировать');
            });
        }

        function contextMenu(element, videos) {
            var back = Lampa.Controller.enabled().name;
            var items = [];

            if (Lampa.Platform.is('android')) items.push({ title: 'Открыть во внешнем плеере', player: 'android' });
            if (Lampa.Platform.is('webos')) items.push({ title: 'Открыть в плеере WebOS', player: 'webos' });

            items.push({ title: 'Отметить просмотренным', action: 'mark' });
            items.push({ title: 'Снять отметку', action: 'unmark' });
            items.push({ title: 'Сбросить таймкод', action: 'timeclear' });
            items.push({ title: 'Копировать ссылку', action: 'copy' });

            if (videos.length > 1) {
                items.push({ title: 'Снять все отметки', action: 'unmark_all' });
            }

            Lampa.Select.show({
                title: 'Действие',
                items: items,
                onBack: function () { Lampa.Controller.toggle(back); },
                onSelect: function (item) {
                    Lampa.Controller.toggle(back);

                    if (item.player) {
                        Lampa.Player.runas(item.player);
                        play(element, videos);
                    }

                    if (item.action === 'mark') element.mark();
                    if (item.action === 'unmark') element.unmark();
                    if (item.action === 'timeclear') element.timeclear();
                    if (item.action === 'unmark_all') videos.forEach(function (v) { if (v.unmark) v.unmark(); });

                    if (item.action === 'copy') {
                        resolve(element, function (stream) {
                            if (!stream || !stream.url) return Lampa.Noty.show('Балансер не отдал ссылку на видео');

                            var picked = streamFor(stream);
                            if (!picked.quality) return copy(picked.url);

                            Lampa.Select.show({
                                title: 'Качество',
                                items: Object.keys(picked.quality).map(function (name) {
                                    return { title: name, file: picked.quality[name] };
                                }),
                                onBack: function () { Lampa.Controller.toggle(back); },
                                onSelect: function (quality) {
                                    Lampa.Controller.toggle(back);
                                    copy(quality.file);
                                }
                            });
                        });
                    }
                }
            });
        }

        // ----- фильтр

        function sortItems() {
            var working = workingOrder();
            if (active && working.indexOf(active) === -1) working.unshift(active);

            return working.map(function (key) {
                return {
                    title: sourceTitle(key),
                    source: key,
                    selected: key === active,
                    ghost: checks[key] !== 'ok'
                };
            });
        }

        function updateSort() {
            filter.set('sort', sortItems());
            filter.chosen('sort', active && sources[active] ? [sourceTitle(active)] : []);

            if (sources_open) refreshSources();
        }

        // «Источник» — своё меню, а не меню фильтра: оно перерисовывается,
        // пока открыто, по мере того как проверку проходят новые источники.
        // Фокус остаётся на том пункте, где был.
        var sources_open = false;
        var sources_focus = '';
        var sources_timer;

        function sourcesTitle() {
            var counts = checkCounts();
            return checksBusy() ? 'Источник · проверено ' + counts.done + ' из ' + counts.total : 'Источник';
        }

        function showSources() {
            var items = sortItems();

            if (!items.length) {
                items = [{ title: checksBusy() ? 'Рабочих пока нет, проверяю…' : 'Рабочих источников нет', noenter: true, ghost: true }];
            }

            sources_open = true;

            Lampa.Select.show({
                title: sourcesTitle(),
                items: items,
                onFocus: function (item) {
                    if (item.source) sources_focus = item.source;
                },
                onSelect: function (item) {
                    sources_open = false;
                    Lampa.Controller.toggle('content');
                    if (item.source) open(item.source, false);
                },
                onBack: function () {
                    sources_open = false;
                    Lampa.Controller.toggle('content');
                    // Закрыл, ничего не выбрав, — открываем лучший сами
                    pick();
                }
            });

            var index = sources_focus ? items.map(function (i) { return i.source; }).indexOf(sources_focus) : -1;
            if (index >= 0) {
                var node = Lampa.Select.render().find('.selectbox-item').eq(index)[0];
                if (node) Lampa.Controller.collectionFocus(node, Lampa.Select.render());
            }
        }

        // Не чаще раза в полсекунды — иначе при пачке результатов меню
        // моргало бы
        function refreshSources() {
            if (sources_timer) return;

            sources_timer = setTimeout(function () {
                sources_timer = null;
                if (!sources_open || destroyed) return;
                if (!Lampa.Select.opened()) {
                    sources_open = false;
                    return;
                }
                showSources();
            }, 500);
        }

        function updateFilter() {
            var choice = sourceChoice();
            var items = [{ title: 'Сбросить выбор', reset: true }];
            var chosen = [];

            var voice_active = voices.filter(function (v) { return v.active; })[0];

            if (voices.length) {
                items.push({
                    title: 'Перевод',
                    subtitle: voice_active ? voice_active.title : '',
                    stype: 'voice',
                    items: voices.map(function (v, i) {
                        return { title: v.title, selected: v === voice_active, index: i };
                    })
                });

                if (voice_active) chosen.push('Перевод: ' + voice_active.title);
            }

            if (seasons.length) {
                var current = currentSeason();

                items.push({
                    title: 'Сезон',
                    subtitle: current.title,
                    stype: 'season',
                    items: seasons.map(function (s, i) {
                        return { title: s.title, selected: s === current, index: i };
                    })
                });

                chosen.push(current.title);
            }

            filter.set('filter', items);
            filter.chosen('filter', chosen);
        }

        function buildFilter() {
            filter.onSearch = function (value) {
                Lampa.Activity.replace({ search: value, clarification: true, similar: true });
            };

            filter.onBack = function () {
                self.start();
            };

            filter.onSelect = function (type, a, b) {
                if (type === 'sort') {
                    Lampa.Select.close();
                    open(a.source, false);
                    return;
                }

                if (type !== 'filter') return;

                if (a.reset) {
                    saveChoice(function (choice) {
                        choice.per[active] = {};
                        choice.voice = '';
                    });
                    setTimeout(function () {
                        Lampa.Select.close();
                        Lampa.Activity.replace({ clarification: false, similar: false, search: '' });
                    }, 10);
                    return;
                }

                if (a.stype === 'voice') {
                    var voice = voices[b.index];
                    saveSourceChoice({ voice: voice.title, voice_url: voice.url });
                    saveChoice(function (choice) { choice.voice = voice.title; });
                    redirected = {};
                    reset();
                    request(voice.url);
                }

                if (a.stype === 'season') {
                    var season = seasons[b.index];
                    saveSourceChoice({ season: season.title });
                    redirected = {};
                    reset();
                    request(season.url);
                }

                setTimeout(Lampa.Select.close, 10);
            };

            if (filter.addButtonBack) filter.addButtonBack();

            filter.render().find('.filter--sort span').text('Источник');

            // Кнопку «Источник» ведём сами — см. showSources
            filter.render().find('.filter--sort').off('hover:enter').on('hover:enter', function () {
                sources_focus = active || sources_focus;
                showSources();
            });
        }

        // ----- жизненный цикл Lampa

        this.initialize = function () {
            this.loading(true);

            buildFilter();

            scroll.body().addClass('torrent-list');
            files.appendFiles(scroll.render());
            files.appendHead(filter.render());
            scroll.minus(files.render().find('.explorer__files-head'));
            scroll.body().append(Lampa.Template.get('online_parser_loading'));

            Lampa.Controller.enable('content');
            this.loading(false);

            // Проверенное недавно — сразу в список и на экран, а серверы
            // опрашиваются как обычно и добавят новое
            if (loadChecks()) {
                updateSort();
                pick();
            }

            externalIds(loadSources);
        };

        this.loading = function (status) {
            if (status) this.activity.loader(true);
            else {
                this.activity.loader(false);
                this.activity.toggle();
            }
        };

        this.create = function () {
            return this.render();
        };

        this.start = function () {
            if (Lampa.Activity.active().activity !== this.activity) return;

            if (!initialized) {
                initialized = true;
                this.initialize();
            }

            Lampa.Background.immediately(Lampa.Utils.cardImgBackgroundBlur(movie));

            Lampa.Controller.add('content', {
                toggle: function () {
                    Lampa.Controller.collectionSet(scroll.render(), files.render());
                    Lampa.Controller.collectionFocus(last || false, scroll.render());
                },
                up: function () {
                    if (Navigator.canmove('up')) Navigator.move('up');
                    else Lampa.Controller.toggle('head');
                },
                down: function () {
                    Navigator.move('down');
                },
                right: function () {
                    if (Navigator.canmove('right')) Navigator.move('right');
                    else filter.show('Фильтр', 'filter');
                },
                left: function () {
                    if (Navigator.canmove('left')) Navigator.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                back: this.back.bind(this)
            });

            Lampa.Controller.toggle('content');
        };

        this.render = function () {
            return files.render();
        };

        this.back = function () {
            Lampa.Activity.backward();
        };

        this.pause = function () {};
        this.stop = function () {};

        this.destroy = function () {
            destroyed = true;
            network.clear();
            pollers.forEach(function (net) { net.clear(); });
            check_nets.forEach(function (net) { net.clear(); });
            timers.forEach(clearTimeout);
            clearTimeout(sources_timer);
            clearTimeout(save_timer);
            clearTimeout(requests_timer);
            clearImages();
            files.destroy();
            scroll.destroy();
        };
    }

    // ----------------------------------------------------------- подключение

    function openOnline(ctx) {
        Lampa.Activity.push({
            url: '',
            title: 'Онлайн',
            component: COMPONENT,
            search: Core.cardTitle(ctx.card),
            search_one: ctx.card.title || ctx.card.name,
            search_two: ctx.card.original_title || ctx.card.original_name,
            movie: ctx.card,
            method: ctx.method,
            page: 1
        });
    }

    function onCard(ctx) {
        if (!Lampa.Storage.get(BUTTON_KEY, true)) return;

        var button = Core.cardButton(ctx, {
            className: 'online-parser--button',
            icon: ICON,
            title: 'Онлайн',
            // Второй в ряду, сразу за первой кнопкой («Смотреть»)
            after: '.full-start__button',
            onEnter: function () { openOnline(ctx); }
        });

        if (button) keepSecond(button);
    }

    // Другие плагины добавляют свои кнопки в тот же ряд позже и каждый в
    // свой момент, так что вставленная один раз кнопка уезжает на случайное
    // место. Следим за рядом и возвращаем её вторым. Не больше двадцати
    // перестановок на карточку — на случай, если кто-то так же держит это
    // место за собой, иначе они перетягивали бы кнопку бесконечно.
    function keepSecond(button) {
        var row = button.parent();
        var moves = 0;

        function place() {
            if (!document.body.contains(button[0])) return observer && observer.disconnect();

            var first = row.children('.full-start__button').not(button).not('.hide').first();
            if (!first.length || button.prev()[0] === first[0]) return;
            if (++moves > 20) return observer && observer.disconnect();

            button.insertAfter(first);
        }

        var observer = typeof MutationObserver !== 'undefined' ? new MutationObserver(place) : null;

        if (observer) observer.observe(row[0], { childList: true });
        else {
            // Старые телевизоры без MutationObserver: поправляем несколько
            // раз в первые секунды, пока плагины грузятся
            [300, 1000, 2500, 5000].forEach(function (delay) { setTimeout(place, delay); });
        }

        place();
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({ component: 'online_parser', name: 'Онлайн', icon: ICON });

        Lampa.SettingsApi.addParam({
            component: 'online_parser',
            param: { name: SERVERS_KEY, type: 'input', values: '', default: DEFAULT_SERVERS, placeholder: DEFAULT_SERVERS },
            field: {
                name: 'Серверы Lampac',
                description: 'Через запятую. Балансеры со всех серверов попадают в общий список источников.'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'online_parser',
            param: { name: BUTTON_KEY, type: 'trigger', default: true },
            field: {
                name: 'Кнопка на карточке',
                description: 'Кнопка «Онлайн» в ряду под постером'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'online_parser',
            param: { name: RCH_KEY, type: 'trigger', default: true },
            field: {
                name: 'Запросы сервера с устройства',
                description: 'Часть серверов качает страницы балансеров через ваше устройство. Присланный сервером код не выполняется никогда.'
            }
        });
    }

    function startPlugin() {
        addTemplates();
        addSettings();

        Lampa.Component.add(COMPONENT, OnlineComponent);
        Core.onFullCard(onCard);

        console.log('Online: plugin v' + manifest.version + ' ready, servers: ' + servers().join(', '));
    }

    Core.boot({
        flag: 'lampa_online_parser_plugin',
        manifest: manifest,
        styles: { id: 'lampa-online-parser-styles', css: STYLES },
        start: startPlugin
    });
})();
