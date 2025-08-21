import os
from datetime import datetime
from flask import Flask, render_template, request, redirect, url_for
from flask_sqlalchemy import SQLAlchemy

# --- SETUP ---
basedir = os.path.abspath(os.path.dirname(__file__))
app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///' + os.path.join(basedir, 'instance', 'project.db')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# --- DATABASE MODELS ---

class Person(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    # This person can be part of multiple debts (e.g., one where they owe me, one where I owe them)
    debts = db.relationship('Debt', backref='person', lazy=True, cascade="all, delete-orphan")

## RENAMED & RESTRUCTURED from Loan to Debt ##
# This now acts as a container for a series of transactions with one person in one direction.
class Debt(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    direction = db.Column(db.String(10), nullable=False) # 'lent' or 'borrowed'
    status = db.Column(db.String(10), default='active', nullable=False) # 'active' or 'settled'
    person_id = db.Column(db.Integer, db.ForeignKey('person.id'), nullable=False)
    # This links a Debt to all its individual transactions
    transactions = db.relationship('Transaction', backref='debt', lazy=True, cascade="all, delete-orphan")

    # This is a helper property to calculate the current balance on the fly
    @property
    def balance(self):
        total = 0
        for t in self.transactions:
            if t.type == 'loan':
                total += t.amount
            elif t.type == 'payment':
                total -= t.amount
        return total

## NEW MODEL ##
# This records every individual financial event.
class Transaction(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    amount = db.Column(db.Float, nullable=False)
    type = db.Column(db.String(10), nullable=False) # 'loan' or 'payment'
    description = db.Column(db.String(200), nullable=False)
    date = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    # This links the transaction to its parent Debt
    debt_id = db.Column(db.Integer, db.ForeignKey('debt.id'), nullable=False)

# --- ROUTES ---

@app.route('/')
def index():
    active_debts = Debt.query.filter_by(status='active').all()
    all_people = Person.query.order_by(Person.name).all()

    total_owed_to_me = sum(d.balance for d in active_debts if d.direction == 'lent')
    total_i_owe = sum(d.balance for d in active_debts if d.direction == 'borrowed')

    # Sort debts by the date of their most recent transaction
    active_debts.sort(key=lambda d: max(t.date for t in d.transactions) if d.transactions else datetime.min, reverse=True)

    return render_template('index.html', 
                           debts=active_debts, 
                           people=all_people,
                           total_owed=total_owed_to_me,
                           total_owe=total_i_owe)

@app.route('/add_person', methods=['POST'])
def add_person():
    name = request.form.get('person_name')
    if name and not Person.query.filter_by(name=name).first():
        db.session.add(Person(name=name))
        db.session.commit()
    return redirect(url_for('index'))

## REWRITTEN LOGIC ##
@app.route('/add_transaction', methods=['POST'])
def add_transaction():
    person_id = request.form.get('person_id')
    amount = float(request.form.get('amount'))
    direction = request.form.get('direction')
    description = request.form.get('description')

    if not all([person_id, amount, direction, description]):
        return redirect(url_for('index'))

    # Find if a debt relationship already exists
    debt = Debt.query.filter_by(person_id=person_id, direction=direction, status='active').first()
    
    # If no debt exists, create one first
    if not debt:
        debt = Debt(person_id=person_id, direction=direction)
        db.session.add(debt)
        # We need to commit here to get a debt.id for the transaction
        db.session.commit()

    # Now, create the new transaction and link it to the debt
    new_trans = Transaction(
        debt_id=debt.id,
        amount=amount,
        type='loan', # Adding money is always a 'loan' type transaction
        description=description
    )
    db.session.add(new_trans)
    db.session.commit()

    return redirect(url_for('index'))

## REWRITTEN LOGIC ##
@app.route('/make_payment/<int:debt_id>', methods=['POST'])
def make_payment(debt_id):
    debt = Debt.query.get_or_404(debt_id)
    payment_amount = float(request.form.get('payment_amount'))
    
    # Cap the payment at the current balance
    if payment_amount > debt.balance:
        payment_amount = debt.balance

    if payment_amount > 0:
        # Create a payment transaction
        payment_trans = Transaction(
            debt_id=debt.id,
            amount=payment_amount,
            type='payment',
            description="Payment"
        )
        db.session.add(payment_trans)
        db.session.commit() # Commit to save the payment

    # Check if the debt is now settled
    if debt.balance < 0.01:
        debt.status = 'settled'
        db.session.commit() # Commit again to update the status

    return redirect(url_for('index'))

@app.route('/settle/<int:debt_id>')
def settle_debt(debt_id):
    debt = Debt.query.get_or_404(debt_id)
    debt.status = 'settled'
    db.session.commit()
    return redirect(url_for('index'))

if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    app.run(debug=True)