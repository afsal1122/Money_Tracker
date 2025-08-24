import os
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for, flash, abort
from flask_sqlalchemy import SQLAlchemy
from werkzeug.security import generate_password_hash, check_password_hash
from flask_login import LoginManager, UserMixin, login_user, logout_user, login_required, current_user

# --- SETUP ---
basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
# You MUST set a secret key for session management and flash messages
app.config['SECRET_KEY'] = 'a-very-secret-and-hard-to-guess-key' 
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'project.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- FLASK-LOGIN SETUP ---
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = 'login' # Redirect to 'login' view if user is not logged in

@login_manager.user_loader
def load_user(user_id):
    return User.query.get(int(user_id))

# --- DATABASE MODELS ---

## NEW MODEL: User ##
# UserMixin provides default implementations for the methods that Flask-Login expects user objects to have.
class User(UserMixin, db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(100), unique=True, nullable=False)
    password_hash = db.Column(db.String(128), nullable=False)
    # This links a User to all their created People
    people = db.relationship('Person', backref='user', lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

class Person(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    debts = db.relationship('Debt', backref='person', lazy=True, cascade="all, delete-orphan")
    ## NEW ##: Foreign key to link a Person to a User
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
            flash('Invalid username or password')
            return redirect(url_for('login'))
        login_user(user)
        return redirect(url_for('index'))
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        if User.query.filter_by(username=request.form.get('username')).first():
            flash('Username already exists. Please choose a different one.')
            return redirect(url_for('register'))
        user = User(username=request.form.get('username'))
        user.set_password(request.form.get('password'))
        db.session.add(user)
        db.session.commit()
        flash('Congratulations, you are now a registered user!')
        login_user(user)
        return redirect(url_for('index'))
    return render_template('register.html')

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))

# --- APPLICATION ROUTES ---

## MODIFIED ##: Protected with @login_required and filtered by user
@app.route('/')
@login_required
def index():
    # Query for debts belonging to the current user
    active_debts = Debt.query.join(Person).filter(
        Person.user_id == current_user.id,
        Debt.status == 'active'
    ).all()
    # Query for people belonging to the current user
    all_people = Person.query.filter_by(user_id=current_user.id).order_by(Person.name).all()

    total_owed_to_me = sum(d.balance for d in active_debts if d.direction == 'lent')
    total_i_owe = sum(d.balance for d in active_debts if d.direction == 'borrowed')
    
    active_debts.sort(key=lambda d: max(t.date for t in d.transactions) if d.transactions else datetime.min, reverse=True)

    return render_template('index.html', debts=active_debts, people=all_people, total_owed=total_owed_to_me, total_owe=total_i_owe)

## MODIFIED ##: Protected and links new person to current_user
@app.route('/add_person', methods=['POST'])
@login_required
def add_person():
    name = request.form.get('person_name')
    if name:
        # Check if this person already exists FOR THIS USER
        existing = Person.query.filter_by(name=name, user_id=current_user.id).first()
        if not existing:
            db.session.add(Person(name=name, user_id=current_user.id))
            db.session.commit()
    return redirect(url_for('index'))

## MODIFIED ##: Protected route
@app.route('/add_transaction', methods=['POST'])
@login_required
def add_transaction():
    person_id = request.form.get('person_id')
    person = Person.query.get(person_id)
    # Security check: ensure the person belongs to the current user
    if person.user_id != current_user.id:
        abort(403) # Forbidden
        
    amount = float(request.form.get('amount'))
    direction = request.form.get('direction')
    description = request.form.get('description')

    debt = Debt.query.filter_by(person_id=person_id, direction=direction, status='active').first()
    if not debt:
        debt = Debt(person_id=person_id, direction=direction)
        db.session.add(debt)
        db.session.commit()

    db.session.add(Transaction(debt_id=debt.id, amount=amount, type='loan', description=description))
    db.session.commit()
    return redirect(url_for('index'))

## MODIFIED ##: Protected and checks ownership
@app.route('/make_payment/<int:debt_id>', methods=['POST'])
@login_required
def make_payment(debt_id):
    debt = Debt.query.get_or_404(debt_id)
    # Security check: ensure the debt belongs to the current user
    if debt.person.user_id != current_user.id:
        abort(403)

    payment_amount = float(request.form.get('payment_amount'))
    if payment_amount > debt.balance: payment_amount = debt.balance
    
    if payment_amount > 0:
        db.session.add(Transaction(debt_id=debt.id, amount=payment_amount, type='payment', description="Payment"))
        db.session.commit()
    
    if debt.balance < 0.01:
        debt.status = 'settled'
        db.session.commit()
    return redirect(url_for('index'))

## MODIFIED ##: Protected and checks ownership
@app.route('/settle/<int:debt_id>')
@login_required
def settle_debt(debt_id):
    debt = Debt.query.get_or_404(debt_id)
    # Security check
    if debt.person.user_id != current_user.id:
        abort(403)
    debt.status = 'settled'
    db.session.commit()
    return redirect(url_for('index'))