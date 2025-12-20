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
app.use(
  cors({
    origin: process.env.CLIENT_URL || "http://localhost:5173",
    credentials: true,
  })
);
app.use(express.json());

// jwt middlewares
const verifyJWT = async (req, res, next) => {
  const token = req?.headers?.authorization?.split(" ")[1];
  console.log(token);
  if (!token) return res.status(401).send({ message: "Unauthorized Access!" });
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.tokenEmail = decoded.email;
    console.log(decoded);
    next();
  } catch (err) {
    console.log(err);
    return res.status(401).send({ message: "Unauthorized Access!", err });
  }
};

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
    const ordersCollection = db.collection("orders");
    const usersCollection = db.collection("users");

    //user related api
    app.post("/user", async (req, res) => {
      const userData = req.body;
      userData.createdAt = new Date().toISOString();
      userData.last_loggedIn = new Date().toISOString();
      userData.role = "customer";
      const query = { email: userData.email };
      const alreadyExists = await usersCollection.findOne({
        email: userData.email,
      });
      console.log("userAlreadyExists", !!alreadyExists);
      if (alreadyExists) {
        console.log("update user info.....");
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }

      console.log("saving new user......");
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    //get a users role
    app.get("/user/role", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      // console.log("get user role for:", email);
      const result = await usersCollection.findOne({ email });
      res.send({ role: result?.role });
    });

    //get all users
    app.get('/users', async (req, res) => {
      const result = await usersCollection.find({}).toArray();
      res.send(result);
    })

    //update user role
    app.patch('/update-role', verifyJWT,  async (req, res) => {
     
      const {email, role } = req.body;
      const result = await usersCollection.updateOne({email}, {
        $set: {role},
      })
      res.send(result);
    })

    //add book
    app.post("/books", async (req, res) => {
      const newBook = req.body;
      // console.log("Adding new book:", newBook);
      const result = await booksCollection.insertOne(newBook);
      res.send(result);
    });

    //books related api
    app.get("/books", async (req, res) => {
      const { status } = req.query;
      const query = status ? { status: status } : {};
      const result = await booksCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/latest-books/", async (req, res) => {
      const { status } = req.query;

      const query = status ? { status } : {};

      const result = await booksCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(4)
        .toArray();

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
          orderId: paymentInfo?.orderId,
          bookId: paymentInfo?.bookId,
          customer: paymentInfo?.customer.email,
        },
        success_url: `${process.env.BASE_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.BASE_URL}/books/${paymentInfo?.bookId}`,
      });

      res.send({ url: session.url });
    });

    //payment success api
    // app.patch("/payment-success", async (req, res) => {
    //   const { sessionId } = req.body;
    //   const session = await stripe.checkout.sessions.retrieve(sessionId);
    //   // console.log(session);
    //   const book = await booksCollection.findOne({
    //     _id: new ObjectId(session.metadata.bookId),
    //   });
    //   const order = await ordersCollection.findOne({
    //     transactionId: session.payment_intent,
    //   });

    //   if (session.status === "complete" && book && !order) {
    //     //save order data in db
    //     const orderInfo = {
    //       bookId: session.metadata.bookId,
    //       transactionId: session.payment_intent,
    //       customer: session.metadata.customer,
    //       orderStatus: "pending",
    //       payment_status: "paid",
    //       customer: book.customer,
    //       librarian: book.librarian,
    //       name: book.title,
    //       quantity: 1,
    //       price: session.amount_total / 100,
    //       paidAt: new Date(),
    //     };
    //     console.log(orderInfo);
    //     const result = await ordersCollection.insertOne(orderInfo);
    //     //update book stock

    //     await booksCollection.updateOne(
    //       {
    //         _id: new ObjectId(session.metadata.bookId),
    //       },
    //       { $inc: { quantity: -1 } }
    //     );
    //     return res.send({
    //       transactionId: session.payment_intent,
    //       orderId: result.insertedId,
    //     });
    //   }
    //   res.send(
    //     res.send({
    //       transactionId: session.payment_intent,
    //       orderId: order,
    //     })
    //   );
    // });

    app.post("/payment-success", async (req, res) => {
      const { sessionId } = req.body;

      const session = await stripe.checkout.sessions.retrieve(sessionId);

      if (session.payment_status !== "paid") {
        return res.status(400).send({ message: "Payment not completed" });
      }

      const orderId = session.metadata.orderId;

      const result = await ordersCollection.updateOne(
        { _id: new ObjectId(orderId) },
        {
          $set: {
            paymentStatus: "paid",
            transactionId: session.payment_intent,
            paidAt: new Date(),
          },
        }
      );

      res.send({ success: true });
    });

    //create orders api
    app.post("/orders", async (req, res) => {
      const order = req.body;
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });

    //get all orders of a user
    app.get("/orders", verifyJWT, async (req, res) => {
      const email = req.tokenEmail;
      const result = await ordersCollection
        .find({ "customer.email": email })
        .toArray();
      res.send(result);
    });

    //cancel order
    app.patch("/orders/cancel/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ordersCollection.updateOne(query, {
        $set: { orderStatus: "cancelled" },
      });
      res.send(result);
    });

    //get all books of a librarian
    app.get("/my-inventory/:email", async (req, res) => {
      const email = req.params.email;
      const result = await booksCollection
        .find({ "librarian.email": email })
        .toArray();
      res.send(result);
    });

    //get book for edit
    app.get("/my-inventory/book/:id", async (req, res) => {
      const id = req.params.id;
      const result = await booksCollection.findOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    //update book data
    app.patch("/my-inventory/book/:id", async (req, res) => {
      const { id } = req.params;
      const updatedBook = req.body;
      const query = { _id: new ObjectId(id) };
      const result = await booksCollection.updateOne(query, {
        $set: {
          title: updatedBook.title,
          author: updatedBook.author,
          price: updatedBook.price,
          status: updatedBook.status,
          description: updatedBook.description,
          image: updatedBook.image,
          updatedAt: updatedBook.updatedAt,
          category: updatedBook.category,
          quantity: updatedBook.quantity,
          tags: updatedBook.tags,
        },
      });
      res.send(result);
    });

    //get all orders of a librarian
    app.get("/manage-orders/:email", async (req, res) => {
      const email = req.params.email;
      const result = await ordersCollection
        .find({ "librarian.email": email })
        .toArray();
      res.send(result);
    });

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
