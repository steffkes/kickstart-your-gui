var express = require('express');

var app = express.createServer();

app.use(express.logger());

app.get('/', function(request, response) {

  response.send( 'Hello World! (' + process.env.REDISTOGO_URL + ')\n' );

});

var port = process.env.PORT || 5001;
app.listen(port, function() {
  console.log("Listening on " + port);
});
