require('dotenv').config();
const Airtable = require('airtable');
const fs = require('fs');
const axios = require('axios');
const _ = require('lodash');
const algoliasearch = require('algoliasearch');
// const { imageUpload } = require('../scratch/index.js');
const async = require('async');

// Setup the github octakit with an access token.
const { Octokit } = require("@octokit/rest");
const octokit = new Octokit({ auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN });
const repo = 'fCTO-CDN';
const owner = 'd1b1';
const branch = 'main'

// create a queue object with concurrency 2
var ghQueue = async.queue(function(task, callback) {
  storeImage(task.url, 'less-code/logos', task.name).then(callback);
}, 1);

// assign a callback
ghQueue.drain(function() {
  console.log("\nAll Airtable Records have been processed.");
});

// Initialize Airtable client.
const airTableBase = new Airtable({ apiKey: process.env.AIRTABLE_API_KEY }).base(process.env.AIRTABLE_BASE_ID);

// Initialize the Algolia client.
const client = algoliasearch(process.env.ALGOLIA_APP_ID, process.env.ALGOLIA_ADMIN_API_KEY);
const AlgoliaIndex = client.initIndex(process.env.ALGOLIA_INDEX_NAME);

async function downloadImage(url) {
  const response = await axios({
    url: url,
    responseType: 'arraybuffer'
  });

  return Buffer.from(response.data, 'binary').toString('base64');
}

async function storeImage(url, path, name) {
  try {
    const base64Image = await downloadImage(url);

    return await imageUploadToRepo(base64Image, path, name);
  } catch (error) {
    console.error('Error in executing image operations:', error);
  }
}

// Initialize Airtable
const data = [];

// Fetch records from the specified table
airTableBase(process.env.AIRTABLE_TABLE_NAME).select({
    // Add any filters or sorting options here
}).eachPage(async (records, fetchNextPage) => {

    var p = []
    var ap = []

    // Process the records
    records.forEach((record) => {
       record.fields = _.mapKeys(record.fields, (v, k) => _.camelCase(k));
       record.fields.objectID = record.id;

       if (record.fields.services === undefined || record.fields.services.length === 0) {
          record.fields.services = [ 'Actung' ]
       }

       if (record.fields.logo && record.fields.logo.length > 0) {
          let url = record.fields.logo[0].url
          let ext = record.fields.logo[0].type.split('/')[1];
          let savePath = `./logos/${record.fields.objectID}.${ext}`;
          record.fields.logo = `${record.fields.objectID}.${ext}`;

          ghQueue.push({ url: url, path: 'less-code/logos', name: `${record.fields.objectID}.${ext}`});
        }

        ap.push(record.fields)
        data.push(record.fields);
    });
 
    // Force the index to run.
    await AlgoliaIndex.saveObjects(ap).then(({ objectIDs }) => {
      console.log('Data pushed to Algolia:', objectIDs);
    }).catch(err => {
      console.error('Error pushing data to Algolia:', err);
    });

    // Force the save to run.
    await Promise.all(p);

    // Fetch the next page of records, if any.
    fetchNextPage();
    
}, (err) => {
    if (err) {
        console.error('Error fetching records:', err);
    }

    console.log('All done. You have a new output file.');
    
    fs.writeFile('./output.json', JSON.stringify(data, ), (err) => {
        if (err) {
            console.error('Error writing file:', err);
        } else {
            console.log('JSON data saved to', data.length);
        }
    });
});

// Function to upload the image
async function imageUploadToRepo(content, destPath, destName) {
    try {
        // Se the message and the content path.
        const message = `Added Image for ${destPath}`;
        const contentPath = `${destPath}/${destName}`;

        // Get the reference for the branch
        const ref = await octokit.rest.git.getRef({
            owner,
            repo,
            ref: `heads/${branch}`
        });

        const sha = ref.data.object.sha;

        // Create blob
        const blob = await octokit.rest.git.createBlob({
            owner,
            repo,
            content,
            encoding: 'base64'
        });

        // Get the latest commit
        const commit = await octokit.rest.git.getCommit({
            owner,
            repo,
            commit_sha: sha
        });

        // Create tree
        const tree = await octokit.rest.git.createTree({
            owner,
            repo,
            tree: [{
                path: contentPath,
                mode: '100644',
                type: 'blob',
                sha: blob.data.sha
            }],
            base_tree: commit.data.tree.sha
        });

        // Create new commit
        const newCommit = await octokit.rest.git.createCommit({
            owner,
            repo,
            message,
            tree: tree.data.sha,
            parents: [commit.data.sha]
        });

        // Update branch reference
        await octokit.rest.git.updateRef({
            owner,
            repo,
            ref: `heads/${branch}`,
            sha: newCommit.data.sha
        });

        console.log('Image uploaded successfully!');

        return;

    } catch (error) {
        console.error('Error uploading image:', error);
    }
}