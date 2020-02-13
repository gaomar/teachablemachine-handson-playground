'use strict';

const canvas = require('canvas')
const line = require('@line/bot-sdk');
const express = require('express');
const fs = require('fs');
const path = require('path');
require("@tensorflow/tfjs-node")
const tmImage = require('@teachablemachine/image')
let model, maxPredictions
require('child_process');
require('dotenv').config();

// LINE Bot Setting
const config = {
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.CHANNEL_SECRET
};
const client = new line.Client(config);

// base URL for webhook server
const baseURL = process.env.BASE_URL;

// express
const app = new express();
const port = 3000;

// serve static and downloaded files
app.use('/static', express.static('static'));
app.use('/downloaded', express.static('downloaded'));

const JSDOM = require('jsdom').JSDOM;
global.window = new JSDOM(`<body><script>document.body.appendChild(document.createElement("hr"));</script></body>`).window;
global.document = window.document;
global.fetch = require('node-fetch');

// root
app.get('/', (req, res) => {
    console.log('Root Accessed!');
    res.send('Hello World!');
});

// LINE Bot webhook callback [POST only]
async function addEndpoint(name, URL){
    const modelURL = URL + 'model.json';
    const metadataURL = URL + 'metadata.json';
    model = await tmImage.load(modelURL, metadataURL);
    maxPredictions = model.getTotalClasses()

    app.post('/' + name, line.middleware(config), (req, res) => {
        console.log('LINE Bot webhook callback handle function called!');
        if (req.body.destination) {
            console.log("Destination User ID: " + req.body.destination);
        }
        // req.body.events should be an array of events
        if (!Array.isArray(req.body.events)) {
            return res.status(500).end();
        }
        // handle each event
        Promise
            .all(req.body.events.map(handleEvent))
            .then(() => res.end())
            .catch((err) => {
                console.error(err);
                res.status(500).end();
            });
    });
}


// callback function to handle a single event
async function handleEvent(event) {
    if (event.replyToken && event.replyToken.match(/^(.)\1*$/)) {
        return console.log("Test hook recieved: " + JSON.stringify(event.message));
    }
    // handle event
    switch (event.type) {
        // handle message event
        case 'message':
            const message = event.message;
            switch (message.type) {
                // handle Text message
                case 'text':
                    return handleText(message, event.replyToken, event.source);
                // handle Image message
                case 'image':
                    return await handleImage(message, event.replyToken);
                // unknown message
                default:
                    throw new Error(`Unknown message: ${JSON.stringify(message)}`);
            }
        // handle follow(友だち追加) event
        case 'follow':
            return replyText(event.replyToken, 'お友だち追加ありがとうございます！');
        // handle unfollow(ブロック) event
        case 'unfollow':
            return console.log(`Unfollowed this bot: ${JSON.stringify(event)}`);
        // handle join(グループ参加) event
        case 'join':
            return replyText(event.replyToken, `Joined ${event.source.type}`);
        // handle leave(グループ退室) event
        case 'leave':
            return console.log(`Left: ${JSON.stringify(event)}`);
        // handle Postback event
        case 'postback':
            let data = event.postback.data;
            // for date time picker
            if (data === 'DATE' || data === 'TIME' || data === 'DATETIME') {
                data += `(${JSON.stringify(event.postback.params)})`;
            }
            return replyText(event.replyToken, `Got postback: ${data}`);
        // handle beacon event
        case 'beacon':
            return replyText(event.replyToken, `Got beacon: ${event.beacon.hwid}`);
        // unknown event
        default:
            throw new Error(`Unknown event: ${JSON.stringify(event)}`);
    }
}

// simple reply function
const replyText = (token, texts) => {
    texts = Array.isArray(texts) ? texts : [texts];
    return client.replyMessage(
        token,
        texts.map((text) => ({ type: 'text', text }))
    );
};

function handleText(message, replyToken, event_source) {
    console.log('handleText function called!');
    return replyText(replyToken, message.text);
}

async function handleImage(message, replyToken) {
    console.log('handleImage function called!');
    let getContent
    if (message.contentProvider.type === "line") {
        const downloadPath = path.join(__dirname, 'downloaded', `${message.id}.jpg`);

        getContent = downloadContent(message.id, downloadPath)
            .then((downloadPath) => {
                return {
                    originalContentUrl: process.env.DL_URL + '/downloaded/' + path.basename(downloadPath)
                };
            });
        

    } else if (message.contentProvider.type === "external") {
        getContent = Promise.resolve(message.contentProvider);
    }

    return getContent
        .then( async ({ originalContentUrl, previewImageUrl }) => {
            var outputText = ''
            var highScore = 0
            await getPrediction(model, originalContentUrl, (prediction) => {
                for (let i = 0; i < maxPredictions; i++) {
                    if (highScore < (prediction[i].probability.toFixed(2) * 100)) {
                        highScore = (prediction[i].probability.toFixed(2) * 100)
                        outputText = prediction[i].className
                    }
                }

                return client.replyMessage(
                    replyToken,
                    {
                        type: 'text',
                        text: `これは、「${outputText}」かな？`
                    }
                );

            });

        });
       
}

async function getPrediction(model, originalContentUrl, fu) {
    const can = canvas.createCanvas(64, 64);
    const ctx = can.getContext('2d');

    const img = new canvas.Image();
    img.onload = async () => {
        ctx.drawImage(img, 0, 0, 64, 64);

        const prediction = await model.predict(can);
        fu(prediction);
    }
    img.onerror = err => { throw err; }
    img.src = originalContentUrl
}

function downloadContent(messageId, downloadPath) {
    console.log('downloadContent function called!');
    return client.getMessageContent(messageId)
        .then((stream) => new Promise((resolve, reject) => {
            const writable = fs.createWriteStream(downloadPath);
            stream.pipe(writable);
            stream.on('end', () => resolve(downloadPath));
            stream.on('error', reject);
        }));
}

// run express server
app.listen(port, async () => {
    await addEndpoint("linebot", baseURL);
    console.log(`サーバ準備完了 ポート:${port}`)
});
