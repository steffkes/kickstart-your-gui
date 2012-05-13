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

app.configure
(
  function(){

    app.set( 'view engine', 'ejs' );
    app.set( 'views', __dirname + '/views' );
    app.use( express.logger() );
    app.use( express.bodyParser() );
    app.use( express.methodOverride() );
    app.use( express.cookieParser() );
    app.use( express.session( { key: 'session_id', secret: "MC44NzA2OTIwMCAxMzM2ODM5MDY1IzRmYWU4Yjk5ZDQ5NzM", store: new RedisStore( { client : redis } ) } ) );
    app.use( express.static( __dirname + '/public' ) );
    app.use( express.errorHandler() );

  }
);

app.configure
(
  'development',
  function() {

    process.env.PORT = 5000;

    app.use( express.errorHandler( { dumpExceptions: true, showStack: true } ) );

  }
);

app.get
(
  '/',
  function( request, response ) {

    var callback = function( err, user_votes )
    {
      redis.sort
      (
        'projects:list', 'DESC', 'BY', 'projects:score:*', 'GET', 'projects:score:*', 'GET', 'projects:data:*',
        function( err, result ) {

          var projects = [];
          var result_count = result.length;

          for( var i = 1; i < result_count; i += 2 )
          {
            var project = JSON.parse( result[i] );
            project._score = parseInt( result[i-1] ) || null;
            project._voted = -1 !== user_votes.indexOf( project.id );

            projects.push( project );
          }

          response.render
          (
            'index',
            { projects: projects }
          );

        }
      );
    }

    if( request.session.twitter )
    {
      redis.smembers
      (
        'users:' + request.session.twitter.screen_name + ':votes',
        callback
      );
    }
    else
    {
      callback( null, [] );
    }

  }
);

app.post
(
  '/',
  function( request, response ) {

    var project = request.body.project;
    project.id = project.name.toLowerCase().replace( /[^\w\d-]/g, '-' ).replace( /-+/g, '-' );
    project.created_at = new Date();
    project.created_by = request.session.twitter.screen_name;

    console.log( project );

    redis.sismember
    (
      'projects:list', project.id,
      function( err, result ) {

        if( 1 === result ) {

          response.send( 'Sorry, we already have a Project named "' + project.name + '" - please check that first', 409 );        

        } else {

          redis.multi()
               .sadd( 'projects:list', project.id )
               .set( 'projects:score:' + project.id, 0 )
               .set( 'projects:data:' + project.id, JSON.stringify( project ) )
               .exec( function( err, result ) {

                 console.log( result );
                 response.redirect( '/' );

               } );

        }

      }
    );

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
 
        request.session.oa = oa;
        request.session.oauth_token = oauth_token;
        request.session.oauth_token_secret = oauth_token_secret;

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

          request.session.oauth_access_token = oauth_access_token;
          request.session.oauth_access_token_secret = oauth_access_token_secret;

          request.session.twitter = results;

          response.redirect( '/' );
        }

      }
    );

  }
);

app.post
(
  '/my/:project_id',
  function( request, response ) {

    var project_id = request.params.project_id;

    redis.sismember
    (
      'projects:list', project_id,
      function( err, result ) {

        if( !result ) {

          response.send( 'Sorry, we have no Project "' + project_id + '"?', 404 );

        } else {

          var user_vote_key = 'users:' + request.session.twitter.screen_name + ':votes';

          redis.sismember
          (
            user_vote_key, project_id,
            function( err, result ) {

              if( result ) {

                response.send( 'Already voted for "' + project_id + '", sorry.', 423 );

              } else {

                redis.multi()
                     .incr( 'projects:score:' + project_id )
                     .sadd( user_vote_key, project_id )
                     .exec( function( err, result ) {

                       console.log( result );
                       response.send( 'OK', 201 );

                     } );

              }

            }
          );

        }

      }
    );

  }
);

app.delete
(
  '/my/:project_id',
  function( request, response ) {

    var project_id = request.params.project_id;

    redis.sismember
    (
      'projects:list', project_id,
      function( err, result ) {

        if( !result ) {

          response.send( 'Sorry, we have no Project "' + project_id + '"?', 404 );

        } else {

          var user_vote_key = 'users:' + request.session.twitter.screen_name + ':votes';

          redis.sismember
          (
            user_vote_key, project_id,
            function( err, result ) {

              if( !result ) {

                response.send( 'There is no vote for you on "' + project_id + '", sorry.', 404 );

              } else {

                redis.multi()
                     .decr( 'projects:score:' + project_id )
                     .srem( user_vote_key, project_id )
                     .exec( function( err, result ) {

                       console.log( result );
                       response.send( 'OK', 200 );

                     } );

              }

            }
          );

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
