var express = require('express');
var url = require('url');

var redis = null;
var app = express.createServer();

app.use(express.logger());

app.configure('development', function(){

  process.env.REDISTOGO_URL = 'redis://0:6d6c5efabd8244b387835e3b131a240f@localhost:9104/'

});

app.get('/', function(request, response) {

  redis.info(function ( err, info ) {

    response.send( 'Hello World!\n' + process.env.REDISTOGO_URL + '\n' + info + '\n' );

  });

  //response.send( 'Hello World! (' + process.env.REDISTOGO_URL + ')\n' );

});

var port = process.env.PORT || 5000;
app.listen(port, function() {

  console.log( "Listening on " + port );

  var parsed_url  = url.parse( process.env.REDISTOGO_URL );
  var parsed_auth = parsed_url.auth.split( ':' );

  redis = require('redis').createClient( parsed_url.port, parsed_url.hostname );

  redis.auth( parsed_auth[1], function(err) {
    if (err) throw err;
  });

  redis.select( parsed_auth[0] );
  redis.on('connect', function() {
    redis.send_anyways = true
    redis.select( parsed_auth[0] );
    redis.send_anyways = false;
  });

  redis.on("error", function (err) {
      console.log("error event - " + redis.host + ":" + redis.port + " - " + err);
  });

});
