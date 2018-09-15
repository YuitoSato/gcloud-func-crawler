const cheerio = require('cheerio');
const fs = require('fs');
const google = require('googleapis');
const gmail = google.gmail('v1');
const DebugAgent = require('@google-cloud/debug-agent');
var log4js = require('log4js');
var logger = log4js.getLogger();
logger.level = 'debug';
logger.debug("Some debug messages");

DebugAgent.start();

const GCF_REGION = 'us-central1';
const GCLOUD_PROJECT = 'gcloud-func-crawler';
const clientSecretJson = JSON.parse(fs.readFileSync('./client_secret.json'));
const oauth2Client = new google.auth.OAuth2(
  clientSecretJson.production.client_id,
  clientSecretJson.production.client_secret,
  clientSecretJson.production.redirect_uris[0]
);

exports.oauth2init = (req, res) => {
    // Parse session cookie
    // Note: this presumes 'token' is the only value in the cookie
    // const cookieStr = (req.headers.cookie || '').split('=')[1];
    // const token = cookieStr ? JSON.parse(decodeURIComponent(cookieStr)) : null;
  
    // If the current OAuth token hasn't expired yet, go to /listlabels
    // if (token && token.expiry_date && token.expiry_date >= Date.now() + 60000) {
    //   return res.redirect('/listEmailsFromAmazon');
    // }
  
    // Define OAuth2 scopes
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly'
    ];
  
    // Generate + redirect to OAuth2 consent form URL
    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'online',
      scope: scopes
    });
    res.redirect(authUrl);
};

exports.oauth2callback = (req, res) => {
    // Get authorization details from request
    const code = req.query.code;
  
    return new Promise((resolve, reject) => {
      // OAuth2: Exchange authorization code for access token
      oauth2Client.getToken(code, (err, token) => {
        if (err) {
          return reject(err);
        }
        return resolve(token);
      });
    })
      .then((token) => {
        // Respond with OAuth token stored as a cookie
        res.cookie('token', JSON.stringify(token));
        res.redirect('/listEmailsFromAmazon');
      })
      .catch((err) => {
        // Handle error
        console.error(err);
        res.status(500).send('Something went wrong; check the logs.');
      });
};

exports.listlabels = (req, res) => {
    // Parse session cookie
    // Note: this presumes 'token' is the only value in the cookie
    const cookieStr = (req.headers.cookie || '').split('=')[1];
    const token = cookieStr ? JSON.parse(decodeURIComponent(cookieStr)) : null;
  
    // If the stored OAuth 2.0 token has expired, request a new one
    if (!token || !token.expiry_date || token.expiry_date < Date.now() + 60000) {
      return res.redirect('/oauth2init').end();
    }
  
    // Get Gmail labels
    oauth2Client.credentials = token;
    return new Promise((resolve, reject) => {
      gmail.users.labels.list({ auth: oauth2Client, userId: 'me' }, (err, response) => {
        if (err) {
          return reject(err);
        }
        return resolve(response.labels);
      });
    })
      .then((labels) => {
        // Respond to request
        res.set('Content-Type', 'text/html');
        res.write(`${labels.length} label(s) found:`);
        labels.forEach(label => res.write(`${label.name}`));
        res.status(200).end();
      })
      .catch((err) => {
        // Handle error
        console.error(err);
        res.status(500).send('Something went wrong; check the logs.');
      });
};

exports.listEmailsFromAmazon = (req, res) => {
  const cookieStr = (req.headers.cookie || '').split('=')[1];
  console.log(cookieStr);
  const token = cookieStr ? JSON.parse(decodeURIComponent(cookieStr)) : null;

  // If the stored OAuth 2.0 token has expired, request a new one
  if (!token || !token.expiry_date || token.expiry_date < Date.now() + 60000) {
    return res.redirect('/oauth2init').end();
  }

  // Get Gmail labels
  oauth2Client.credentials = token;
  return new Promise((resolve, reject) => {
    gmail.users.messages.list({ 
      auth: oauth2Client,
      userId: 'me',
      q: 'from:auto-confirm@amazon.co.jp'
    }, (err, response) => {
      if (err) {
        return reject(err);
      }
      return resolve(response.messages);
    });
  })
  .then(messages => {
    console.log(messages);
    res.set('Content-Type', 'application/json');
    res.set(JSON.stringify(messages));
    res.status(200).end();
  })
  .catch(err => {
    console.error(err);
    res.status(500).send(JSON.stringify(err));
  });
}