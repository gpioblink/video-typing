'use strict';

const uuid = require('uuid');
const AWS = require('aws-sdk');

AWS.config.setPromisesDependency(require('bluebird'));

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const lambda = new AWS.Lambda({
  region: process.env.LAMBDA_REGION
});

module.exports.getVideoService = async (event, context) => {
  const cache = await invokeCacheVideo(event.body);

  if(cache['Payload']) {
    const payload = JSON.parse(cache['Payload']);
    if(payload.body) {
      const body = JSON.parse(payload.body);
      if(!body['error'] && body['source']) {
        return {
          statusCode: 200,
          headers: {'Access-Control-Allow-Origin': '*'},
          body: JSON.stringify({'res': JSON.parse(body['source']), 'type': 'cache'})
        };
      }
    }
  }

  const real = await invokeRealVideo(event.body); 

  if(real['Payload']) {
    const payload = JSON.parse(real['Payload']);
    if(payload.body) {
      const body = JSON.parse(payload.body);
      if(body['res']) {
        await saveCacheVideo(JSON.stringify({'url': JSON.parse(event.body).url, 'source': JSON.stringify(body.res)}));
        return {
          statusCode: 200,
          headers: {'Access-Control-Allow-Origin': '*'},
          body: JSON.stringify({'res': body['res'], 'type': 'real'})
        }
      };
    }
  }

  return {
    statusCode: 200,
    headers: {'Access-Control-Allow-Origin': '*'},
    body: JSON.stringify({'error': `no available video source was found`, 'type': 'error'})
  };
};

const invokeCacheVideo = body => {
  const params = {
    FunctionName: process.env.CACHE_VIDEO_SOURCE_LAMBDA_NAME,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({'body': body})
  };
  return lambda.invoke(params).promise();
};

const invokeRealVideo = body => {
  const params = {
    FunctionName: process.env.REAL_VIDEO_SOURCE_LAMBDA_NAME,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({'body': body})
  };
  return lambda.invoke(params).promise();
};

const saveCacheVideo = body => {
  const params = {
    FunctionName: process.env.SAVE_VIDEO_SOURCE_LAMBDA_NAME,
    InvocationType: 'RequestResponse',
    Payload: JSON.stringify({'body': body})
  };
  return lambda.invoke(params).promise();
};

module.exports.saveVideoCache = (event, context, callback) => {
  const requestBody = JSON.parse(event.body);
  const siteUrl = requestBody.url;
  const sourceJson = requestBody.source;

  if(typeof siteUrl !== 'string' || typeof sourceJson !== 'string') {
    console.error('Validation Failed');
    callback(new Error('Couldn\'t submit video source because of validation errors.'));
    return;
  }

  submitVideoSourceP(videoSourceInfo(siteUrl,sourceJson))
   .then(res => {
     callback(null, {
       statusCode: 200,
       headers: {
        'Access-Control-Allow-Origin': '*',
       },
       body: JSON.stringify({
         message: `Sucessfully submitted video source with siteUrl ${siteUrl}`
       })
     });
   })
   .catch(err => {
     callback(null, {
       statusCode: 500,
       headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': true,
       },
       body: JSON.stringify({
         message: `Unable to submit video source with siteUrl ${siteUrl}`
       })
     });
   })

  return {
    statusCode: 200,
    body: JSON.stringify(
      {
        message: 'Go Serverless v1.0! Your function executed successfully!',
        input: event,
      },
      null,
      2
    ),
  };
  // Use this code if you don't use the http event with the LAMBDA-PROXY integration
  // return { message: 'Go Serverless v1.0! Your function executed successfully!', event };
};

const submitVideoSourceP = videoSource => {
  console.log('Submitting video source');
  const videoSourceInfo = {
    TableName: process.env.VIDEO_TYPING_TABLE,
    Item: videoSource,
  };
  return dynamoDb.put(videoSourceInfo).promise()
   .then(res => videoSource);
};

const videoSourceInfo = (siteUrl, sourceJson) => {
  const timestamp = new Date().getTime();
  return {
    id: siteUrl,
    source: sourceJson,
    updatedAt: timestamp,
  };
};

module.exports.getVideoCache = (event, context, callback) => {
  const requestBody = JSON.parse(event.body);
  const siteUrl = requestBody.url;
  const params = {
    TableName: process.env.VIDEO_TYPING_TABLE,
    Key: {
      id: siteUrl,
    },
  };

  dynamoDb.get(params).promise()
   .then(result => {
     const body = result.Item;
     const currentTime = new Date().getTime()
     // 該当なしや、前回取得時から3時間以上経過しているものは返さない
     if(!body['updatedAt'] || currentTime - parseInt(body['updatedAt']) > 10800000) {
      const response = {
        statusCode: 200,
        headers: {
         'Access-Control-Allow-Origin': '*',
        },
        body: JSON.stringify({'error': 'not found or expired'}),
      };
      callback(null,response);
      return;
     }

     const response = {
       statusCode: 200,
       headers: {
        'Access-Control-Allow-Origin': '*',
       },
       body: JSON.stringify(body),
     };
     callback(null, response);
   })
   .catch(error => {
     console.error(error);
     callback(new Error('Couldn\'t fetch video source'));
     return;
   });
};
