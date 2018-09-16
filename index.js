const fs = require('fs');
const google = require('googleapis');
const gmail = google.gmail('v1');
const cheerio = require('cheerio');
const DebugAgent = require('@google-cloud/debug-agent');

DebugAgent.start();

const myModule = require('./hoge');
let val = myModule.hello();

const env = "local";

const prefix = {
  "local": "/gcloud-func-crawler/us-central1",
  "production": ""
}

const GCF_REGION = 'us-central1';
const GCLOUD_PROJECT = 'gcloud-func-crawler';
const clientSecretJson = JSON.parse(fs.readFileSync('./client_secret.json'));
const oauth2Client = new google.auth.OAuth2(
  clientSecretJson[env].client_id,
  clientSecretJson[env].client_secret,
  clientSecretJson[env].redirect_uris[0]
);

exports.cheerioSample = (req, res) => {
  const text = fs.readFileSync('./sample/sample2.txt', 'utf-8');
  const $ = cheerio.load(text.replace(/[\\$'"]/g, ""));
  const html = $('td[class=name]').html()

  const productText = cheerio.load(text.replace(/[\\$'"]/g, ""))('td[class=name]').html()
    .replace(/<br>/, '<div class=\"category\">')
    .replace(/<br>/, '</div><div class=\"distributor\">')
    .replace(/<br>/, '</div>');

  const $product = cheerio.load(productText);

  const name = $product('a').text().trim();
  const category = $product('div[class=category]').text().trim();
  const distributor = $product('div[class=distributor]').text().trim();
  const price = $('td[class=price] strong').text().replace(/[￥,]/g, '').trim();
  const orderedAt = $('table[id=orderDetails] tbody tr td span').text().replace(/注文日：/, '').trim();

  const result = {
    name: name,
    category: category,
    distributor: distributor,
    price: price,
    orderedAt: orderedAt
  }

  res.set('Content-Type', 'application/json');
  console.log(result);
  $('td[class=name] a').replaceWith('').text()
  res.status(200).send(JSON.stringify(result));
}

exports.oauth2init = (req, res) => {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.readonly'
    ];
  
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
        res.redirect(prefix[env] + '/listEmailsFromAmazon');
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
    return res.redirect(prefix[env] + '/oauth2init').end();
  }

  // Get Emails
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

      return resolve(getEmail(response.messages[0].id));
    });
  })
  .then(message => {
    const result = new Buffer(message.parts[1].body.data, 'base64').toString().replace(/[\\$'"]/g, "");
    res.set('Content-Type', 'application/json');
    res.status(200).send(JSON.stringify(scrapeOrderFromHtmlStr(result)));
  })
  .catch(err => {
    console.error(err);
    res.set('Content-Type', 'application/json');
    res.status(500).send(JSON.stringify(err));
  });
}

function getEmail(id) {
  return new Promise((resolve, reject) => {
    gmail.users.messages.get({
      auth: oauth2Client,
      userId: 'me',
      id: id
    }, (err, response) => {
      if (err) {
        return reject(err);
      }

      return resolve(response.payload);
    });
  });
}

function scrapeOrderFromHtmlStr(htmlStr) {
  const $ = cheerio.load(htmlStr);

  const productText = $('td[class=name]').html()
    .replace(/<br>/, '<div class=\"category\">')
    .replace(/<br>/, '</div><div class=\"distributor\">')
    .replace(/<br>/, '</div>');

  const $product = cheerio.load(productText);

  const name = $product('a').text().trim();
  const category = $product('div[class=category]').text().trim();
  const distributor = $product('div[class=distributor]').text().trim();
  const price = $('td[class=price] strong').text().replace(/[￥,]/g, '').trim();
  const orderedAt = $('table[id=orderDetails] tbody tr td span').text().replace(/注文日：/, '').trim();

  return {
    name: name,
    category: category,
    distributor: distributor,
    price: price,
    orderedAt: orderedAt
  };
}

exports.asyncF = async (req, res) => {
  res.set('Content-Type', 'application/json');
  res.status(200).send(JSON.stringify(1));
};
