const mongoose = require('mongoose');

const uri = 'mongodb://kisandeveloper2_db_user:djAI9PymI5218cDJ@ac-5a6srvg-shard-00-00.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-01.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-02.kqatqru.mongodb.net:27017/?ssl=true&replicaSet=atlas-b6w25z-shard-0&authSource=admin&appName=call-app';

async function test() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to DB');
    
    const User = require('./models/User');
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const allUsers = await usersCollection.find().toArray();
    console.log('All Users:');
    allUsers.forEach(u => console.log(`- Name: ${u.name}, Status: ${u.status}, OnLeave: ${u.on_leave}`));
    
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

test();
