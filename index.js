const fs = require('fs');
const google = require('googleapis');
const gmail = google.gmail('v1');
const cheerio = require('cheerio');
const DebugAgent = require('@google-cloud/debug-agent');
const { promisify } = require('util');

DebugAgent.start();

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
      res.cookie('token', JSON.stringify(token));
      res.redirect(prefix[env] + '/listEmailsFromAmazon');
    })
    .catch((err) => {
      res.status(500).send('Something went wrong; check the logs.');
    });

  // return promisify(oauth2Client.getToken)(code)
  //   .then((token) => {
  //     res.cookie('token', JSON.stringify(token));
  //     res.redirect(prefix[env] + '/listEmailsFromAmazon');
  //   })
  //   .catch((err) => {
  //     res.status(500).send('Something went wrong; check the logs.');
  //   });
};

exports.listEmailsFromAmazon = async (req, res) => {
  const cookieStr = (req.headers.cookie || '').split('=')[1];
  const token = cookieStr ? JSON.parse(decodeURIComponent(cookieStr)) : null;

  if (!token || !token.expiry_date || token.expiry_date < Date.now() + 60000) {
    return res.redirect(prefix[env] + '/oauth2init').end();
  }

  oauth2Client.credentials = token;
  return promisify(gmail.users.messages.list)
    ({
      auth: oauth2Client,
      userId: 'me',
      maxResults: 10,
      q: 'from:auto-confirm@amazon.co.jp'
    })
    .then(res => res.messages)
    .then(messages => { 
      return Promise.all(messages.map(message => 
        getEmail(message.id)
      ))
    })
    .then(messages => {
      console.log(messages);
      return messages.map(message => {
        const result = new Buffer(message.parts[1].body.data, 'base64').toString().replace(/[\\$'"]/g, "");
        return scrapeOrderFromHtmlStr(result);
      })
    })
    .then(orders => {
      res.set('Content-Type', 'application/json');
      res.status(200).send(JSON.stringify(orders));
    })
    .catch(err => {
      res.set('Content-Type', 'application/json');
      res.status(500).send(JSON.stringify(err));
    });
}

const getEmail = async (id) => {
  return promisify(gmail.users.messages.get)({
    auth: oauth2Client,
    userId: 'me',
    id: id
  }).then(res => {
    return res.payload;
  });
}

const scrapeOrderFromHtmlStr = (htmlStr) => {
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
