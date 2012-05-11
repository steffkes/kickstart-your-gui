var express = require('express');

var app = express.createServer(express.logger());

app.get('/', function(request, response) {
  response.send('Hello World!\n');
});

var port = process.env.PORT || 5001;
app.listen(port, function() {
  console.log("Listening on " + port);
});
