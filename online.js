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
    // Если любимый балансер так и не нашёлся, через столько открываем первый
    // попавшийся — ждать остальные серверы до конца незачем.
    var PICK_FALLBACK = 6000;

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
        // Сервер Lampac умеет его найти — спрашиваем первый, кто ответит.
        function externalIds(done) {
            var list = servers();

            if (movie.imdb_id && movie.kinopoisk_id) return done();

            (function next(i) {
                if (i >= list.length || destroyed) return done();

                var query = ['id=' + encodeURIComponent(movie.id), 'serial=' + (serial ? 1 : 0)];
                if (movie.imdb_id) query.push('imdb_id=' + encodeURIComponent(movie.imdb_id));
                if (movie.kinopoisk_id) query.push('kinopoisk_id=' + encodeURIComponent(movie.kinopoisk_id));

                var ids = new Lampa.Reguest();
                ids.timeout(8000);
                ids.silent(account(list[i] + 'externalids?' + query.join('&')), function (json) {
                    if (json && typeof json === 'object') {
                        Object.keys(json).forEach(function (name) {
                            if (json[name]) movie[name] = json[name];
                        });
                    }
                    done();
                }, function () {
                    next(i + 1);
                });
            })(0);
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
                    pick(false);

                    if ((json && json.ready) || polls >= LIFE_POLLS) finish();
                    else timers.push(setTimeout(function () { poll(memkey); }, LIFE_INTERVAL));
                }, function () {
                    polls++;
                    if (polls >= LIFE_POLLS) finish();
                    else timers.push(setTimeout(function () { poll(memkey); }, LIFE_INTERVAL));
                });
            }

            net.timeout(15000);
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

            filter.render().find('.filter--sort').append('<span class="online-parser-loader"></span>');

            timers.push(setTimeout(function () { pick(true); }, PICK_FALLBACK));

            var direct = Object.keys(DIRECT).filter(function (id) { return DIRECT[id].match(movie); });
            var total = list.length + direct.length;

            function settle() {
                settled++;

                if (settled === total) {
                    filter.render().find('.online-parser-loader').remove();
                    pick(true);
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

        // Открываем то, что смотрели в этом фильме, а если он новый — тот
        // балансер, что выбирали последним вообще. Пока серверы досчитывают,
        // ждём именно его; сдаёмся на первый попавшийся, только когда ждать
        // больше нечего.
        function pick(give_up) {
            if (active || destroyed) return;

            var wanted = [loadChoice().source, Lampa.Storage.get(LAST_SOURCE_KEY, '')];

            for (var i = 0; i < wanted.length; i++) {
                if (wanted[i] && sources[wanted[i]] && sources[wanted[i]].show) return open(wanted[i], true);
            }

            // Имя балансера без сервера: вдруг его перенесли на другой
            var name = String(wanted[1] || '').split('|')[1];
            var same = name && order.filter(function (key) {
                return sources[key].balanser === name && sources[key].show;
            })[0];
            if (same) return open(same, true);

            if (!give_up) return;

            var first = nextCandidate();

            if (first) return open(first, true);
            if (settled < servers().length) return;

            if (messages.length) message('Ничего не нашлось', messages.join('<br>'));
            else message('Ничего не нашлось', 'Ни один балансер не знает этот фильм. Попробуйте уточнить название через поиск.', true);
        }

        // Следующий, кого стоит попробовать: сначала проверенные сервером,
        // потом остальные, и никого дважды.
        function nextCandidate() {
            var left = order.filter(function (key) { return sources[key].show && !tried[key]; });
            var checked = left.filter(function (key) { return sources[key].confirmed; });

            return checked[0] || left[0];
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

            var items, buttons;

            if (json && Array.isArray(json.items)) {
                items = json.items;
                buttons = json.buttons || [];
            } else {
                var html = $('<div>' + (typeof body === 'string' ? body : '') + '</div>');
                items = parseElements(html, '.videos__item');
                buttons = parseElements(html, '.videos__button');
            }

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

                var saved = sourceChoice().season;
                var season = seasons.filter(function (s) { return s.title === saved; })[0] || seasons[0];

                return request(season.url);
            }

            doesNotAnswer();
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

        function qualityLabel(element) {
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

        function updateSort() {
            filter.set('sort', order.map(function (key) {
                return {
                    title: sources[key].name,
                    source: key,
                    selected: key === active,
                    ghost: !sources[key].show
                };
            }));

            filter.chosen('sort', active && sources[active] ? [sources[active].name] : []);
        }

        function updateFilter() {
            var choice = sourceChoice();
            var items = [{ title: 'Сбросить выбор', reset: true }];
            var chosen = [];

            var voice_active = voices.filter(function (v) { return v.active; })[0];
            var season_title = choice.season;

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
                var current = seasons.filter(function (s) { return s.title === season_title; })[0] || seasons[0];

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
            timers.forEach(clearTimeout);
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

        Core.cardButton(ctx, {
            className: 'online-parser--button',
            icon: ICON,
            title: 'Онлайн',
            after: '.view--torrent',
            onEnter: function () { openOnline(ctx); }
        });
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
