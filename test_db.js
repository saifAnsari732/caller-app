const mongoose = require('mongoose');

const uri = 'mongodb://kisandeveloper2_db_user:djAI9PymI5218cDJ@ac-5a6srvg-shard-00-00.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-01.kqatqru.mongodb.net:27017,ac-5a6srvg-shard-00-02.kqatqru.mongodb.net:27017/?ssl=true&replicaSet=atlas-b6w25z-shard-0&authSource=admin&appName=call-app';

async function test() {
  try {
    await mongoose.connect(uri);
    console.log('Connected to DB');
    
    const User = require('./models/User');
    try {
      const newUser = {
        name: 'test mongoose',
        mobile: '99052348552',
        email: 'test12@me.com',
        employee_id: 'tc1112',
        password: 'password123',
        role: 'telecaller'
      };
      await User.create(newUser);
      console.log('Mongoose Inserted successfully!');
    } catch (err) {
      console.log('Mongoose Insert Error Code:', err.code);
      console.log('Mongoose Insert Error Message:', err.message);
    }
  } catch (err) {
    console.error(err);
  } finally {
    await mongoose.disconnect();
  }
}

test();
