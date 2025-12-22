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

    //role middleware
    const verifyAdmin = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "admin") {
        return res.status(403).send({ message: "Admin Access Required" });
      }
      next();
    };

    //librarian role middleware
    const verifyLibrarian = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "librarian") {
        return res.status(403).send({ message: "Librarian Access Required" });
      }
      next();
    };

    //customer role middleware
    const verifyCustomer = async (req, res, next) => {
      const email = req.tokenEmail;
      const user = await usersCollection.findOne({ email });
      if (user?.role !== "customer") {
        return res.status(403).send({ message: "Customer Access Required" });
      }
      next();
    };

    //statistics api
    app.get("/admin-statistics", verifyJWT, verifyAdmin, async (req, res) => {
      const totalBooks = await booksCollection.estimatedDocumentCount();
      const totalOrders = await ordersCollection.estimatedDocumentCount();
      const totalUsers = await usersCollection.estimatedDocumentCount();
      const totalPendingOrders = await ordersCollection.countDocuments({
        orderStatus: "pending",
      });

      const revenueCursor = ordersCollection.aggregate([
        { $match: { paymentStatus: "paid" } },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: { $toDouble: "$price" } }, // Converts string to number
          },
        },
      ]);
      const revenueResult = await revenueCursor.toArray();
      const totalRevenue = revenueResult[0]?.totalRevenue || 0;

      res.send({
        totalBooks,
        totalOrders,
        totalUsers,
        totalPendingOrders,
        totalRevenue,
      });
    });

    //customer statistics
    app.get(
      "/customer-statistics",
      verifyJWT,
      verifyCustomer,
      async (req, res) => {
        const email = req.tokenEmail;
        const totalOrders = await ordersCollection.countDocuments({
          "customer.email": email,
        });

        const activeOrders = await ordersCollection.countDocuments({
          "customer.email": email,
          orderStatus: "shipped",
        });

        const spentCursor = ordersCollection.aggregate([
          { $match: { "customer.email": email, paymentStatus: "paid" } },
          {
            $group: {
              _id: null,
              totalSpent: { $sum: { $toDouble: "$price" } }, // Converts string to number
            },
          },
        ]);
        const spentResult = await spentCursor.toArray();
        const totalSpent = spentResult[0]?.totalSpent || 0;

        res.send({
          totalOrders,
          activeOrders,
          totalSpent,
        });
      }
    );

    //librarian statistics
    app.get(
      "/librarian-statistics",
      verifyJWT,
      verifyLibrarian,
      async (req, res) => {
        const email = req.tokenEmail;
        const totalBooks = await booksCollection.countDocuments({
          "librarian.email": email,
        });
        const totalOrders = await ordersCollection.countDocuments({
          "librarian.email": email,
        });
        const shippedOrders = await ordersCollection.countDocuments({
          "librarian.email": email,
          orderStatus: "shipped",
        });
        const pendingOrders = await ordersCollection.countDocuments({
          "librarian.email": email,
          orderStatus: "pending",
        });
        const deliveredOrders = await ordersCollection.countDocuments({
          "librarian.email": email,
          orderStatus: "delivered",
        });
        const cancelledOrders = await ordersCollection.countDocuments({
          "librarian.email": email,
          orderStatus: "cancelled",
        });
        const revenueCursor = ordersCollection.aggregate([
          { $match: { "librarian.email": email, paymentStatus: "paid" } },
          {
            $group: {
              _id: null,
              totalRevenue: { $sum: { $toDouble: "$price" } },
            },
          },
        ]);
        const revenueResult = await revenueCursor.toArray();
        const totalRevenue = revenueResult[0]?.totalRevenue || 0;
        res.send({
          totalBooks,
          totalOrders,
          shippedOrders,
          totalRevenue,
          pendingOrders,
          deliveredOrders,
          cancelledOrders,
        });
      }
    );

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
      // console.log("userAlreadyExists", !!alreadyExists);
      if (alreadyExists) {
        // console.log("update user info.....");
        const result = await usersCollection.updateOne(query, {
          $set: {
            last_loggedIn: new Date().toISOString(),
          },
        });
        return res.send(result);
      }

      // console.log("saving new user......");
      const result = await usersCollection.insertOne(userData);
      res.send(result);
    });

    //update user data
    app.patch("/update-user-data/:email", async (req, res) => {
      const email = req.params.email;
      const { name, image } = req.body;
      const updateDoc = {};
      if (name) updateDoc.name = name;
      if (image) updateDoc.image = image;

      const result = await usersCollection.updateOne(
        { email },
        { $set: updateDoc }
      );
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
    app.get("/users", verifyJWT, verifyAdmin, async (req, res) => {
      const adminEmail = req.tokenEmail;
      const result = await usersCollection
        .find({ email: { $ne: adminEmail } })
        .toArray();
      res.send(result);
    });

    //update user role
    app.patch("/update-role", verifyJWT, verifyAdmin, async (req, res) => {
      const { email, role } = req.body;
      const result = await usersCollection.updateOne(
        { email },
        {
          $set: { role },
        }
      );
      res.send(result);
    });

    //add book
    app.post("/books", verifyJWT, verifyLibrarian, async (req, res) => {
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
    app.get("/books/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await booksCollection.findOne(query);
      res.send(result);
    });

    //PAYMENT INTEGRATION
    app.post("/create-checkout-session", verifyJWT, async (req, res) => {
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

    //payment history
    app.get("/payments", verifyJWT, verifyCustomer, async (req, res) => {
      const email = req.tokenEmail;
      const query = { "customer.email": email, paymentStatus: "paid" };
      const result = await ordersCollection.find(query).toArray();
      res.send(result);
    });

    //create orders api
    app.post("/orders", async (req, res) => {
      const orderData = req.body;
      const result = await ordersCollection.insertOne(orderData);
      res.send(result);
    });

    //get all orders of a user
    app.get("/orders", verifyJWT, verifyCustomer, async (req, res) => {
      const email = req.tokenEmail;
      const result = await ordersCollection
        .find({ "customer.email": email })
        .toArray();
      res.send(result);
    });

    //cancel order
    app.patch("/orders/cancel/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ordersCollection.updateOne(query, {
        $set: { orderStatus: "cancelled" },
      });
      res.send(result);
    });

    //order status update by librarian
    app.patch("/orders/update-status/:id", verifyJWT, async (req, res) => {
      const id = req.params.id;
      const { status } = req.body;
      const query = { _id: new ObjectId(id) };
      const result = await ordersCollection.updateOne(query, {
        $set: { orderStatus: status },
      });
      res.send(result);
    });

    //get all books of a librarian
    app.get(
      "/my-inventory/:email",
      verifyJWT,
      verifyLibrarian,
      async (req, res) => {
        const email = req.params.email;
        const result = await booksCollection
          .find({ "librarian.email": email })
          .toArray();
        res.send(result);
      }
    );

    //get all books for a admin
    app.get("/admin-inventory", verifyJWT, verifyAdmin, async (req, res) => {
      const result = await booksCollection.find().toArray();
      res.send(result);
    });

    //admin delete any book
    app.delete(
      "/admin-inventory/book/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await booksCollection.deleteOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    //change book status
    app.patch(
      "/update-status/:id",
      verifyJWT,
      verifyAdmin,
      async (req, res) => {
        const { id } = req.params;
        const { status } = req.body;
        const query = { _id: new ObjectId(id) };
        const result = await booksCollection.updateOne(query, {
          $set: { status },
        });
        res.send(result);
      }
    );

    //get book for edit
    app.get(
      "/my-inventory/book/:id",
      verifyJWT,
      verifyLibrarian,
      async (req, res) => {
        const id = req.params.id;
        const result = await booksCollection.findOne({
          _id: new ObjectId(id),
        });
        res.send(result);
      }
    );

    //update book data
    app.patch(
      "/my-inventory/book/:id",
      verifyJWT,
      verifyLibrarian,
      async (req, res) => {
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
      }
    );

    //get all orders of a librarian
    app.get(
      "/manage-orders/:email",
      verifyJWT,
      verifyLibrarian,
      async (req, res) => {
        const email = req.params.email;
        const result = await ordersCollection
          .find({ "librarian.email": email })
          .toArray();
        res.send(result);
      }
    );

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
