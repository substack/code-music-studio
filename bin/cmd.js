#!/usr/bin/env node
var http = require('http');
var url = require('url');
var fs = require('fs');
var path = require('path');
var minimist = require('minimist');
var trumpet = require('trumpet');
var concat = require('concat-stream');
var through = require('through2');
var qs = require('querystring');
var marked = require('marked');

var argv = minimist(process.argv.slice(2), {
    alias: { p: 'port', d: 'datadir', i: 'input', q: 'quiet' },
    default: { datadir: '.' }
});
if (argv.h || argv.help) {
    fs.createReadStream(__dirname + '/usage.txt').pipe(process.stdout);
    return;
}

var port = parseInt(process.env.PORT) || argv.port
    || parseInt(argv._[0]) || 8000
;
var ecstatic = require('ecstatic')(__dirname + '/../static');

var level = require('level');
var bytewise = require('bytewise');
var datadir = path.join(
    process.env.DATADIR || argv.datadir,
    'code-music-studio.db'
);
var db = level(datadir, { keyEncoding: bytewise, valueEncoding: 'json' });
var getSong = require('../lib/song.js')(db);
var getHistory = require('../lib/history.js')(db);
var getRecent = require('../lib/recent.js')(db);
var render = {
    history: require('../render/history.js'),
    recent: require('../render/recent.js')
};

var server = http.createServer(function (req, res) {
    var u = url.parse(req.url), m = req.method;
    try { var parts = decodeURIComponent(u.pathname).split('/').slice(1) }
    catch (err) { return respond(400, err) }
    var params = qs.parse(u.query);
    
    if (m === 'POST' && /\.json$/.test(u.pathname)) {
        parts[parts.length-1] = parts[parts.length-1].replace(/\.json$/, '');
        var key = [ 'song', parts, Date.now() ];
        req.pipe(concat(function (body) {
            try { var song = JSON.parse(body) }
            catch (err) { return respond(400, err) }
            var rows = [
                { type: 'put', key: key, value: song },
                { type: 'put', key: [ 'song-time', key[2], parts ], value: 0 }
            ];
            db.batch(rows, function (err) {
                if (err) respond(500, err)
                else res.end('ok\n');
            });
        }));
    }
    else if (u.pathname === '/') {
        ecstatic(req, res);
    }
    else if (m === 'GET' && parts[0] !== '-' && /\.js$/.test(u.pathname)) {
        parts[parts.length-1] = parts[parts.length-1].replace(/\.js$/, '');
        getSong(parts, params, function (err, song) {
            if (err) return respond(500, '// ' + err)
            allowOrigin(res);
            res.setHeader('content-type', 'text/javascript');
            res.end(song.code)
        });
    }
    else if (m === 'GET' && parts[0] === '-' && parts[1] === 'history.json') {
        allowOrigin(res);
        res.setHeader('content-type', 'application/json');
        getHistory(parts.slice(2))
            .pipe(through(function (row, enc, next) {
                var rec = row.value;
                rec.time = row.key[2];
                this.push(JSON.stringify(rec) + '\n');
                next();
            }))
            .pipe(res)
        ;
    }
    else if (m === 'GET' && parts[0] === '-' && parts[1] === 'history') {
        var first = true;
        getHistory(parts.slice(2)).pipe(render.history()).pipe(res);
    }
    else if (m === 'GET' && parts[0] === '-' && parts[1] === 'recent.json') {
        var write = function (row, enc, next) {
            this.push(JSON.stringify(row) + '\n');
            next();
        };
        allowOrigin(res);
        res.setHeader('content-type', 'application/json');
        getRecent(params).pipe(through.obj(write)).pipe(res);
    }
    else if (m === 'GET' && parts[0] === '-' && parts[1] === 'recent') {
        getRecent(params).pipe(render.recent(params)).pipe(res);
    }
    else if (m === 'GET' && parts[0] === '-' && parts[1] === 'help') {
        fs.readFile(__dirname + '/../doc/index.markdown', 'utf8',
        function (err, src) {
            if (err) return respond(500, err);
            res.setHeader('content-type', 'text/html');
            res.end(marked(src));
        });
    }
    else if (m === 'GET' && parts[0] !== '-') {
        var tr = trumpet();
        var s = tr.createWriteStream('#code');
        var title = parts.join('/');
        tr.select('#save *[name=title]').setAttribute('value', title);
        var href = encodeURIComponent(title);
        tr.select('.history-link').setAttribute('href', '/-/history/' + href);
        readStream('index.html').pipe(tr).pipe(res);
        
        getSong(parts, params, function (err, song) {
            if (err) {
                s.write('// ' + err + '\n');
                s.end('return function (t) {\n  return 0\n}');
            }
            else s.end(song.code);
        });
    }
    else {
        req.url = req.url.replace(/^\/\-\//, '/');
        ecstatic(req, res);
    }
    
    function respond (code, err) {
        res.statusCode = code;
        res.end(err + '\n');
    }
});
server.listen(port);
server.on('listening', function () {
    console.log('listening on http://localhost:' + server.address().port);
});

var wsock = require('websocket-stream');
var net = require('net');
var split = require('split');
var state = argv.state || {};

if (argv.input) {
    var input = process.stdin;
    var setter = through(function (line, enc, next) {
        try { var row = JSON.parse(line) }
        catch (err) { return }
        if (!row || typeof row !== 'object') return;
        Object.keys(row).forEach(function (key) {
            state[key] = row[key];
        });
        next();
    });
    input.pipe(split()).pipe(setter);
    
    wsock.createServer({ server: server }, function (stream) {
        input.pipe(stream);
        stream.write(JSON.stringify(state) + '\n');
    });
}

function readStream (file) {
    return fs.createReadStream(path.join(__dirname, '../static', file));
}

function allowOrigin (res) {
    res.setHeader('access-control-allow-origin', '*');
}
