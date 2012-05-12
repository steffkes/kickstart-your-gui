var express = require('express');
var url = require('url');
var oauth = require('oauth').OAuth;

// -- expressjs

var app = express.createServer();
app.use( express.logger() );
app.use( express.bodyParser() );
app.use( express.cookieParser() );
app.use( express.session( { secret: "MC44NzA2OTIwMCAxMzM2ODM5MDY1IzRmYWU4Yjk5ZDQ5NzM" } ) );

app.configure
(
  'development',
  function() {

    process.env.REDISTOGO_URL = 'redis://0:secret@localhost:9104/'
    process.env.PORT = 5000;

  }
);

// -- redistogo

var parsed_url  = url.parse( process.env.REDISTOGO_URL );
var parsed_auth = parsed_url.auth.split( ':' );

var redis = require('redis').createClient( parsed_url.port, parsed_url.hostname );

redis.auth
(
  parsed_auth[1],
  function(err) {

    if (err) throw err;

  }
);

redis.select( parsed_auth[0] );
redis.on
(
  'connect',
  function() {

    redis.send_anyways = true
    redis.select( parsed_auth[0] );
    redis.send_anyways = false;

  }
);

redis.on
(
  'error',
  function (err) {

    console.log( 'redis error (' + redis.host + ':' + redis.port + '): ' + err );

  }
);

app.get
(
  '/',
  function( request, response ) {

    if( request.session.twitter_data && request.session.twitter_data.screen_name )
    {
      response.send( 'Heya ' + request.session.twitter_data.screen_name + ' =)' );
    }
    else
    {
      response.send( 'You\'re not logged in - <a href="/auth">go and do so</a>' );
    }

  }
);

app.get
(
  '/auth',
  function( request, response ) {

    var oa = new oauth
    (
      'https://api.twitter.com/oauth/request_token',
      'https://api.twitter.com/oauth/access_token',
      'pD4hi0wMlrfVO35SCve4HA',
      'qRm5x4wTrzYEaSKkgmBr6lpnbDhzxTCu8EjrprknE',
      '1.0',
      'http://' + request.headers.host + '/auth/callback',
      'HMAC-SHA1'
    );

    oa.getOAuthRequestToken( function( err, oauth_token, oauth_token_secret, results ) {

      if( err ) {

        console.log( err );
        response.send( err );
   
      } else {
 
        // store the tokens in the session
        request.session.oa = oa;
        request.session.oauth_token = oauth_token;
        request.session.oauth_token_secret = oauth_token_secret;
        console.log( 'oauth_token: ' + oauth_token );
        console.log( 'oauth_token_secret: ' + oauth_token_secret );

        // redirect the user to authorize the token
        response.redirect( 'https://api.twitter.com/oauth/authenticate?oauth_token=' + oauth_token );
	  
      }

    });

  }
);

app.get
(
  '/auth/callback',
  function( request, response ) {

    var oa = new oauth
    (
      request.session.oa._requestUrl,
      request.session.oa._accessUrl,
      request.session.oa._consumerKey,
      request.session.oa._consumerSecret,
      request.session.oa._version,
      request.session.oa._authorize_callback,
      request.session.oa._signatureMethod
    );

    oa.getOAuthAccessToken
    (
      request.session.oauth_token, 
      request.session.oauth_token_secret, 
      request.param( 'oauth_verifier' ), 
      function( err, oauth_access_token, oauth_access_token_secret, results ) {

        console.log( 'results: ', results );

        if( err ) {

          console.log( err );
          response.send( err );

        } else {

          // store the access token in the session
          request.session.oauth_access_token = oauth_access_token;
          request.session.oauth_access_token_secret = oauth_access_token_secret;
          console.log( 'oauth_access_token: ' + oauth_access_token );
          console.log( 'oauth_access_token_secret: ' + oauth_access_token_secret );

          request.session.twitter_data = results;

          response.redirect( '/' );
        }

      }
    );

  }
);

app.listen
(
  process.env.PORT,
  function() {

    console.log( 'Listening on ' + process.env.PORT );

  }
);
