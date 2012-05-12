var express = require('express');
var url = require('url');
var oauth = require('oauth').OAuth;
var redis_lib = require('redis');
var RedisStore = require('connect-redis')(express);

// -- redis

var redis_url  = url.parse( process.env.REDISTOGO_URL || 'redis://0:secret@localhost:9104/' );
var redis_data = redis_url.auth.split( ':' );
var redis_db = redis_data[0];
var redis_pass = redis_data[1];

var redis = redis_lib.createClient( redis_url.port, redis_url.hostname );

redis.auth
(
  redis_pass,
  function(err) {

    if (err) throw err;

  }
);

redis.select( redis_db );
redis.on
(
  'connect',
  function() {

    redis.send_anyways = true
    redis.select( redis_db );
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

// -- expressjs

var app = express.createServer();
app.use( express.logger() );
app.use( express.bodyParser() );
app.use( express.cookieParser() );
app.use( express.session( { key: 'session_id', secret: "MC44NzA2OTIwMCAxMzM2ODM5MDY1IzRmYWU4Yjk5ZDQ5NzM", store: new RedisStore( { client : redis } ) } ) );

app.configure
(
  'development',
  function() {

    process.env.PORT = 5000;

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
