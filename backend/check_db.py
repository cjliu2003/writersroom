#!/usr/bin/env python
import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

# Load environment variables
load_dotenv()

# Get database URL
db_url = os.environ.get('DB_URL_SYNC')
scene_id = 'dcd65300-3435-4bc0-9b7e-b5d9da1d074e'

if not db_url:
    print("Error: DB_URL_SYNC environment variable not set.")
    exit(1)

try:
    # Create engine and connect to database
    engine = create_engine(db_url)
    
    with engine.connect() as conn:
        # Check if scene exists
        scene_query = text(f"SELECT scene_id, script_id, scene_heading FROM scenes WHERE scene_id = '{scene_id}'")
        scene_result = conn.execute(scene_query)
        scene_rows = list(scene_result)
        
        if scene_rows:
            for row in scene_rows:
                scene_id_val = row[0]
                script_id_val = row[1]
                heading = row[2]
                print(f"Scene found: ID={scene_id_val}, Script ID={script_id_val}, Heading={heading}")
                
                # Check if the script exists
                script_query = text(f"SELECT script_id, title FROM scripts WHERE script_id = '{script_id_val}'")
                script_result = conn.execute(script_query)
                script_rows = list(script_result)
                
                if script_rows:
                    for s_row in script_rows:
                        print(f"Script found: ID={s_row[0]}, Title={s_row[1]}")
                else:
                    print(f"ERROR: Script with ID={script_id_val} NOT FOUND in scripts table")
        else:
            print(f"Scene with ID={scene_id} NOT FOUND in scenes table")
            
        # Check if the scene ID is in scene_write_ops
        write_ops_query = text(f"SELECT op_id, scene_id FROM scene_write_ops WHERE scene_id = '{scene_id}' LIMIT 5")
        write_ops_result = conn.execute(write_ops_query)
        write_ops_rows = list(write_ops_result)
        
        if write_ops_rows:
            print(f"Scene found in scene_write_ops ({len(write_ops_rows)} entries):")
            for op_row in write_ops_rows:
                print(f"  Op ID={op_row[0]}, Scene ID={op_row[1]}")
        else:
            print(f"Scene with ID={scene_id} NOT FOUND in scene_write_ops table")
except Exception as e:
    print(f"Error: {str(e)}")
