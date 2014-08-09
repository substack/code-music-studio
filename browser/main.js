var baudio = require('webaudio');
var observable = require('observable');
var hyperquest = require('hyperquest');
var keycode = require('keycode');

document.querySelector('#save').addEventListener('submit', onsubmit);
function onsubmit (ev) {
    ev.preventDefault();
    var title = this.elements.title.value;
    var href = location.protocol + '//' + location.host + '/'
        + encodeURIComponent(title) + '.json'
    ;
    var r = hyperquest.post(href);
    r.on('data', function (buf) {
        console.log(buf);
    });
    r.end(JSON.stringify({ title: title, code: code.value }));
    if (window.history.pushState) {
        window.history.pushState({}, title, '/' + title);
    }
    document.querySelector('.history-link').setAttribute(
        'href', '/-/history/' + encodeURIComponent(title)
    );
}

var music = function (t) { return 0 };
var ascope = require('amplitude-viewer')();
ascope.appendTo('#ascope');

var work = require('webworkify');
var w = work(require('./fft.js'));
var queue = [];
w.addEventListener('message', function (ev) {
    queue.shift()(ev.data);
});

var fscope = require('frequency-viewer')({
    worker: function (data, cb) {
        queue.push(cb);
        w.postMessage(data);
    }
});
fscope.appendTo('#fscope');

var play = document.querySelector('#play');
play.addEventListener('click', togglePlay);
ascope.on('click', togglePlay);

var paused = false;
function togglePlay () {
    paused = !paused;
    play.textContent = paused ? 'play' : 'pause';
}

window.addEventListener('resize', function (ev) {
    ascope.resize();
    fscope.resize();
});

window.addEventListener('keydown', function (ev) {
    var name = keycode(ev);
    if (name === 'page up' || name === 'page down') {
        ev.preventDefault();
    }
    document.body.scrollTop = 0;
});

var code = document.querySelector('#code');
code.addEventListener('keydown', function (ev) {
    var name = keycode(ev);
    if (name === 'page up') {
        var x = code.scrollTop - code.offsetHeight;
        code.scrollTop = Math.max(0, x);
    }
    else if (name === 'page down') {
        var x = code.scrollTop + code.offsetHeight;
        code.scrollTop = Math.min(code.scrollHeight, x);
    }
});

var sandbox = require('browser-module-sandbox')({
    cdn: 'http://wzrd.in',
    container: document.getElementById('sandbox'),
    iframeHead: '',
    iframeBody: '',
    iframeStyle: ''
});

sandbox.on('bundleStart', function () {
    console.log('bundle start');
});

sandbox.on('bundleEnd', function (html) {
    console.log('bundle end');
    var source = html.script;
    try { music = Function(source)() }
    catch (err) { return console.log(err) }
    ascope.draw(music);
});

observable.input(code)(function (source) {
    var pre = [
      'var _i = document.querySelector("#sandbox iframe");',
      'var _b = _i && _i.contentDocument.querySelector("body")',
      'var display = _b || document.body;'
    ].join('\n')
    sandbox.bundle(pre + source);
});

setInterval(function f () {
    if (paused) return;
    ascope.setTime(time);
    ascope.draw(music);
    fscope.draw(data);
}, 50);

var time = 0;
var data = new Float32Array(4000);
var dataIx = 0;

var b = baudio(function (t) {
    time = t;
    if (paused) return 0;
    var x = music(t);
    data[dataIx++ % data.length] = x;
    return x;
});
b.play();
