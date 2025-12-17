require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion } = require("mongodb");
const app = express();
const port = process.env.PORT || 3000;

//middleware
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Book2Door Server is running");
});

const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    await client.connect();
    const db = client.db("Bood2Door");
    const booksCollection = db.collection("books");

    //books related api
    app.get("/books", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    app.post('/books', async (req, res) => {
      const newBook = req.body;
      console.log('Adding new book:', newBook);
      const result = await booksCollection.insertOne(newBook);
      res.send(result);
    })





    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Book2Door app listening on port ${port}`);
});
