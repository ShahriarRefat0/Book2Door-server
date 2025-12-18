require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const stripe = require("stripe")(process.env.STRIPE_KEY);
const port = process.env.PORT || 3000;
const admin = require("firebase-admin");

const decoded = Buffer.from(process.env.FB_SERVICE_KEY, "base64").toString(
  "utf-8"
);

const serviceAccount = JSON.parse(decoded);
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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
    // await client.connect();
    const db = client.db("Bood2Door");
    const booksCollection = db.collection("books");
    const ordersCollection = db.collection('orders');



    //add book
    app.post("/books", async (req, res) => {
      const newBook = req.body;
      // console.log("Adding new book:", newBook);
      const result = await booksCollection.insertOne(newBook);
      res.send(result);
    });

    //books related api
    app.get("/books", async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    //get book details
    app.get("/books/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await booksCollection.findOne(query);
      res.send(result);
    });

    //PAYMENT INTEGRATION
    app.post("/create-checkout-session", async (req, res) => {
      const paymentInfo = req.body;

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: paymentInfo?.name,
                author: paymentInfo?.author,
                images: [paymentInfo.image],
              },
              unit_amount: paymentInfo?.price * 100,
            },
            quantity: paymentInfo?.quantity,
          },
        ],
        customer_email: paymentInfo?.customer.email,
        mode: "payment",
        metadata: {
          bookId: paymentInfo?.bookId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL}/books/${paymentInfo?.bookId}`,
      });

      res.send({ url: session.url });
    });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      // console.log(session);
const book = await booksCollection.findOne({ _id: new ObjectId(session.metadata.bookId) });
      const order = await ordersCollection.findOne({
        transactionId: session.payment_intent,
      });
      
      if (session.status === 'complete' && book && !order) {
        //save order data in db
        const orderInfo = {
          bookId: session.metadata.bookId,
          transactionId: session.payment_intent,
          customer: session.metadata.customer,
          orderStatus: 'pending',
          librarian: book.librarian,
          name: book.title,
          quantity: 1,
          price: session.amount_total / 100,
          createAt: new Date(),
          
        }
        // console.log(orderInfo);
        const result = await ordersCollection.insertOne(orderInfo);
        //update book stock

        await booksCollection.updateOne({
          _id: new ObjectId(session.metadata.bookId),
        },
          {$inc: {quantity:-1}}
        );
        return res.send({
          transactionId: session.payment_intent, orderId: result.insertedId 
        });
      }
      res.send(
        res.send({
          transactionId: session.payment_intent,
          orderId: order,
        })
      );
    });

    //orders related api
    app.post('/orders', async (req, res) => {
      const order = req.body;
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    })

    //get all orders of a user
    app.get('/orders/:email', async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection.find({ "customer.email": email }).toArray();
      res.send(result);
    })
    //get all orders of a librarian 
    app.get('/manage-orders/:email', async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection
        .find({ "librarian.email": email })
        .toArray();
      res.send(result);
    })
    //get all books of a librarian 
    app.get('/my-inventory/:email', async (req, res) => {
      const email = req.params.email;
      const result = await booksCollection
        .find({ "librarian.email": email })
        .toArray();
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
