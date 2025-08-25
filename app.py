import os
from datetime import datetime, timedelta # Import timedelta for "Remember Me"
from flask import Flask, render_template, request, redirect, url_for, flash, abort, send_from_directory
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user

# --- SETUP ---
basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
app.config['SECRET_KEY'] = 'a-very-secret-and-hard-to-guess-key' 
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'project.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# ## IMPROVEMENT 1: Configure "Remember Me" cookie duration ##
app.config['REMEMBER_COOKIE_DURATION'] = timedelta(days=365)

db = SQLAlchemy(app)

# --- FLASK-LOGIN SETUP ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login'
login_manager.login_message_category = 'info' # For better flash messages

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- DATABASE MODELS (No changes here) ---

class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    people = db.relationship('Person', backref='user', lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Person(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    debts = db.relationship('Debt', backref='person', lazy=True, cascade="all, delete-orphan")
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

class Debt(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    direction = db.Column(db.String(10), nullable=False)
    status = db.Column(db.String(10), default='active', nullable=False)
    person_id = db.Column(db.Integer, db.ForeignKey('person.id'), nullable=False)
    transactions = db.relationship('Transaction', backref='debt', lazy=True, cascade="all, delete-orphan")

    @property
    def balance(self):
        return sum(t.amount for t in self.transactions if t.type == 'loan') - sum(t.amount for t in self.transactions if t.type == 'payment')

class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    amount = db.Column(db.Float, nullable=False)
    type = db.Column(db.String(10), nullable=False)
    description = db.Column(db.String(200), nullable=False)
    date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    debt_id = db.Column(db.Integer, db.ForeignKey('debt.id'), nullable=False)

# --- AUTHENTICATION ROUTES ---

@app.route('/login', methods=['GET', 'POST'])
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form.get('username')).first()
        if user is None or not user.check_password(request.form.get('password')):
            # ## IMPROVEMENT 3: Use flash categories ##
            flash('Invalid username or password.', 'danger')
            return redirect(url_for('login'))
        
        # ## IMPROVEMENT 1: Handle the "Remember Me" checkbox ##
        remember = request.form.get('remember') is not None
        login_user(user, remember=remember)
        return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        # ## IMPROVEMENT 4: Basic input validation ##
        if not username or not password:
            flash('Username and password are required.', 'warning')
            return redirect(url_for('register'))

        if User.query.filter_by(username=username).first():
            flash('Username already exists. Please choose a different one.', 'warning')
            return redirect(url_for('register'))
            
        user = User(username=username)
        user.set_password(password)
        db.session.add(user)
        db.session.commit()
        flash('Congratulations, you are now a registered user!', 'success')
        login_user(user) # Log in the user immediately after registration
        return redirect(url_for('index'))
    return render_template('register.html')

@app.route('/logout')
@login_required
def logout():
    logout_user()
    flash('You have been logged out.', 'info')
    return redirect(url_for('login'))

# --- APPLICATION ROUTES ---

@app.route('/')
@login_required
def index():
    active_debts = Debt.query.join(Person).filter(
        Person.user_id == current_user.id,
        Debt.status == 'active'
    ).all()
    all_people = Person.query.filter_by(user_id=current_user.id).order_by(Person.name).all()
    total_owed_to_me = sum(d.balance for d in active_debts if d.direction == 'lent')
    total_i_owe = sum(d.balance for d in active_debts if d.direction == 'borrowed')
    active_debts.sort(key=lambda d: max(t.date for t in d.transactions) if d.transactions else datetime.min, reverse=True)
    return render_template('index.html', debts=active_debts, people=all_people, total_owed=total_owed_to_me, total_owe=total_i_owe)

@app.route('/add_person', methods=['POST'])
@login_required
def add_person():
    name = request.form.get('person_name', '').strip() # Use .strip() to remove whitespace
    if name:
        existing = Person.query.filter_by(name=name, user_id=current_user.id).first()
        if not existing:
            db.session.add(Person(name=name, user_id=current_user.id))
            db.session.commit()
            flash(f'"{name}" has been added to your people.', 'success')
    else:
        flash('Person name cannot be empty.', 'warning')
    return redirect(url_for('index'))

@app.route('/add_transaction', methods=['POST'])
@login_required
def add_transaction():
    person_id = request.form.get('person_id')
    amount_str = request.form.get('amount')
    description = request.form.get('description', '').strip()
    
    # ## IMPROVEMENT 4 & 5: Better validation and security ##
    if not all([person_id, amount_str, description]):
        flash('All fields are required.', 'warning')
        return redirect(url_for('index'))

    person = Person.query.filter_by(id=person_id, user_id=current_user.id).first()
    if not person:
        # This is a critical security check. If the person doesn't exist or doesn't belong to the user, abort.
        abort(403) 
    
    try:
        amount = float(amount_str)
        if amount <= 0:
            raise ValueError
    except (ValueError, TypeError):
        flash('Invalid amount entered.', 'danger')
        return redirect(url_for('index'))

    direction = request.form.get('direction')
    debt = Debt.query.filter_by(person_id=person.id, direction=direction, status='active').first()
    if not debt:
        debt = Debt(person_id=person.id, direction=direction)
        db.session.add(debt)
        db.session.commit()

    db.session.add(Transaction(debt_id=debt.id, amount=amount, type='loan', description=description))
    db.session.commit()
    flash('Transaction added successfully.', 'success')
    return redirect(url_for('index'))

# ... (make_payment and settle_debt routes have no changes) ...
@app.route('/make_payment/<int:debt_id>', methods=['POST']) #...
@app.route('/settle/<int:debt_id>') #...

# ## IMPROVEMENT 2: Routes to serve the PWA files ##
@app.route('/manifest.json')
def serve_manifest():
    return send_from_directory(app.root_path, 'manifest.json')

@app.route('/service-worker.js')
def serve_sw():
    return send_from_directory(app.root_path, 'service-worker.js', mimetype='application/javascript')