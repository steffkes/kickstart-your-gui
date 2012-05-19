var express = require('express');
var url = require('url');
var oauth = require('oauth').OAuth;
var oauth2 = require('oauth').OAuth2;
var redis_lib = require('redis');
var RedisStore = require('connect-redis')(express);

var project_options = {

  languages : {
    java : 'Java',
    python : 'Python'
  },
  buildsystems : {
    ant : 'Ant',
    maven : 'Maven'
  }

};

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

    app.set( 'view engine', 'jade' );
    app.set( 'view options', { layout: false } );
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

app.dynamicHelpers
(
  {
    user: function( request, response )
    {
      return request.session.user || null;
    },
    project_options : function( request, response )
    {
      return project_options;
    }
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

    if( request.session.user )
    {
      redis.smembers
      (
        'users:' + request.session.user.ident + ':votes',
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
    project.created_by = request.session.user.ident;

    // -- languages

    if( project.languages )
    {
      project.languages = project.languages.filter
      (
        function( element, index, array )
        {
          return 'undefined' !== typeof project_options.languages[element];
        }
      );

      if( 0 === project.languages.length )
      {
        delete project.languages;
      }
    }

    // -- buildsystems

    if( project.buildsystems )
    {
      project.buildsystems = project.buildsystems.filter
      (
        function( element, index, array ) 
        {
          return 'undefined' !== typeof project_options.buildsystems[element];
        } 
      );
      if( 0 === project.buildsystems.length )
      {
        delete project.buildsystems;
      }
    }

    // -- references

    var references = project.references;
    var references_count = references.length;

    project.references = {};
    for( var i = 0; i < references_count; i++ )
    {
      project.references[ references[i].url ] = references[i].desc || null;
    }
    delete project.references[''];

    // --

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
                 if( request.xhr ) {

                   response.send( 'OK', 201 );

                 } else {

                   response.redirect( '/' );

                 }

               } );

        }

      }
    );

  }
);

app.put
(
  '/:project_id',
  function( request, response )
  {
    var project_id = request.params.project_id;

    redis.sismember
    (
      'projects:list', project_id,
      function( err, result )
      {
        if( !result )
        {
          response.send( 'Sorry, we have no Project "' + project_id + '"?', 404 );
          return false;
        }

        redis.get
        (
          'projects:data:' + project_id,
          function( err, project )
          {
            project = JSON.parse( project );

            if( project.created_by !== request.session.user.ident )
            {
              response.send( 'Dude, that\'s not your Project?', 401 );
              return false;
            }

            project.wip = !!parseInt( request.body.wip, 10 );

            redis.set
            (
              'projects:data:' + project_id,
              JSON.stringify( project )
            );

            if( request.xhr ) {

              response.send( 'OK', 200 );

            } else {

              response.redirect( '/' );

            }
          }
        );
      }
    );
  }
);

app.get
(
  '/auth',
  function( request, response ) {

    response.send( 'Use <a href="/auth/twitter">Twitter</a>, <a href="/auth/github">GitHub</a>, <a href="/auth/linkedin">LinkedIn</a> or <a href="/auth/google">Google</a>, thanks' );

  }
);

app.delete
(
  '/auth',
  function( request, response ) {

    request.session.destroy();
    response.redirect( '/' );

  }
);

app.get
(
  '/auth/twitter',
  function( request, response ) {

    var oa = new oauth
    (
      'https://api.twitter.com/oauth/request_token',
      'https://api.twitter.com/oauth/access_token',
      'pD4hi0wMlrfVO35SCve4HA',
      'qRm5x4wTrzYEaSKkgmBr6lpnbDhzxTCu8EjrprknE',
      '1.0',
      'http://' + request.headers.host + '/auth/twitter/callback',
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
  '/auth/twitter/callback',
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

        if( err ) {

          console.log( err );
          response.send( err );

        } else {

          request.session.oauth_access_token = oauth_access_token;
          request.session.oauth_access_token_secret = oauth_access_token_secret;

          request.session.user = {
            type : 'twitter',
            ident : 'twitter_' + results.user_id,
            name : results.screen_name
          };

          response.redirect( '/' );
        }

      }
    );

  }
);


app.get
(
  '/auth/linkedin',
  function( request, response ) {

    var oa = new oauth
    (
      'https://api.linkedin.com/uas/oauth/requestToken',
      'https://api.linkedin.com/uas/oauth/accessToken',
      'xepy4uorsk03',
      'nt2P9iM09ZHs1yJ6',
      '1.0',
      'http://' + request.headers.host + '/auth/linkedin/callback',
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

        response.redirect( 'https://www.linkedin.com/uas/oauth/authenticate?oauth_token=' + oauth_token );

      }

    });

  }
);

app.get
(
  '/auth/linkedin/callback',
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

        if( err ) {

          console.log( err );
          response.send( err );

        } else {

          request.session.oauth_access_token = oauth_access_token;
          request.session.oauth_access_token_secret = oauth_access_token_secret;

          oa.get(
            'http://api.linkedin.com/v1/people/~:(id,first-name)?format=json',
            oauth_access_token,
            oauth_access_token_secret,
            function( err, results ) {

              results = JSON.parse( results );

              request.session.user = {
                type : 'linkedin',
                ident : 'linkedin_' + results.id,
                name : results.firstName
              };

              response.redirect( '/' );

            }
          );

        }

      }
    );

  }
);

app.get
(
  '/auth/google',
  function( request, response ) {

    var oa = new oauth2(
      '197270800263.apps.googleusercontent.com',
      '7CHf6dUG76kp1FUMLf2RdDMe',
      'https://accounts.google.com',
      '/o/oauth2/auth',
      '/o/oauth2/token'
    );

    var redirect_url = oa.getAuthorizeUrl({
      response_type : 'code',
      redirect_uri : 'http://' + request.headers.host + '/auth/google/callback',
      scope : [ 'https://www.googleapis.com/auth/userinfo.profile' ],
    });

    request.session.oa = oa;
    response.redirect( redirect_url );

  }
);

app.get
(
  '/auth/google/callback',
  function( request, response ) {

    var oa = new oauth2(
      request.session.oa._clientId,
      request.session.oa._clientSecret,
      request.session.oa._baseSite,
      request.session.oa._authorizeUrl,
      request.session.oa._accessTokenUrl
    );

    var parsed_url= url.parse( request.originalUrl, true );

    oa.getOAuthAccessToken(
      parsed_url.query.code,
      {
        redirect_uri: 'http://' + request.headers.host + '/auth/google/callback',
        grant_type: 'authorization_code'
      },
      function( err, access_token, refresh_token, results ) {

        console.log( access_token );
        request.session.oauth_access_token = access_token;

        oa.get(
          'https://www.googleapis.com/oauth2/v1/userinfo',
          access_token,
          function( err, results ) {

            results = JSON.parse( results );
            request.session.user = {
              type : 'google',
              ident : 'google_' + results.id,
              name : results.given_name || results.name
            };
            response.redirect( '/' );

          }
        );

      }
    );

  }
);

app.get
(
  '/auth/github',
  function( request, response ) {

    var oa = new oauth2(
      'dc924182dfc6561652f3',
      '28240306ad22b08ac321cc9034e5623e240a3e05',
      'https://github.com',
      '/login/oauth/authorize',
      '/login/oauth/access_token'
    );

    var redirect_url = oa.getAuthorizeUrl({
      redirect_uri : 'http://' + request.headers.host + '/auth/github/callback',
      scope : [],
    });

    request.session.oa = oa;
    response.redirect( redirect_url );

  }
);

app.get
(
  '/auth/github/callback',
  function( request, response ) {

    var oa = new oauth2(
      request.session.oa._clientId,
      request.session.oa._clientSecret,
      request.session.oa._baseSite,
      request.session.oa._authorizeUrl,
      request.session.oa._accessTokenUrl
    );

    var parsed_url = url.parse( request.originalUrl, true );

    oa.getOAuthAccessToken(
      parsed_url.query.code,
      {},
      function( err, access_token, refresh_token, results ) {

        console.log( access_token );
        request.session.oauth_access_token = access_token;

        oa.get(
          'https://api.github.com/user',
          access_token,
          function( err, results ) {

            results = JSON.parse( results );
            request.session.user = {
              type : 'github',
              ident : 'github_' + results.id,
              name : results.login
            };
            response.redirect( '/' );


          }
        );

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

          var user_vote_key = 'users:' + request.session.user.ident + ':votes';

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
                       if( request.xhr ) {

                         response.send( 'OK', 201 );

                       } else {

                         response.redirect( '/' );

                       }

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

          var user_vote_key = 'users:' + request.session.user.ident + ':votes';

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
                       if( request.xhr ) {

                         response.send( 'OK', 200 );

                       } else {

                         response.redirect( '/' );

                       }

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
